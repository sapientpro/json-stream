export type Observer<T> = {
  next?: (value: T) => void;
  error?: (error: any) => void;
  complete?: () => void;
};

export type ObserverErrorHandler = (error: unknown) => void;

export type SubjectOptions = {
  /** Maximum queued values per async consumer; defaults to Infinity. */
  maxBufferedChunks?: number;
  /** Callback exceptions are reported here; by default they are thrown in a microtask. */
  onObserverError?: ObserverErrorHandler;
};

export function validateBufferLimit(limit: number): void {
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new RangeError('maxBufferedChunks must be a positive safe integer or Infinity');
  }
}

const reportUnhandledError = (error: unknown): void => {
  queueMicrotask(() => { throw error; });
};

export type Subscription = { unsubscribe(): void };

export interface Observable<T> extends AsyncIterable<T> {
  subscribe(observer: Observer<T> | ((value: T) => void)): Subscription;
}

// rxjs interop key: Symbol.observable when the runtime has it, else '@@observable'
const OBSERVABLE: any = (typeof Symbol === 'function' && (Symbol as any).observable) || '@@observable';

const NOOP: Subscription = {unsubscribe() {}};

/** Multicast push source. Values emitted before a subscriber attaches are lost. */
export class Subject<T> implements Observable<T> {
  #observers = new Set<Observer<T>>();
  #closed = false;
  #error: any = null;
  #failed = false;
  readonly #maxBufferedChunks: number;
  readonly #onObserverError: ObserverErrorHandler;

  constructor({maxBufferedChunks = Infinity, onObserverError = reportUnhandledError}: SubjectOptions = {}) {
    validateBufferLimit(maxBufferedChunks);
    this.#maxBufferedChunks = maxBufferedChunks;
    this.#onObserverError = onObserverError;
  }

  get observed(): boolean {
    return this.#observers.size > 0;
  }

  #notify(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      try {
        this.#onObserverError(error);
      } catch (reporterError) {
        reportUnhandledError(reporterError);
      }
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  next(value: T): void {
    if (this.#closed) return;
    for (const observer of this.#observers) this.#notify(() => observer.next?.(value));
  }

  error(error: any): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#error = error;
    this.#failed = true;
    const observers = [...this.#observers];
    this.#observers.clear();
    for (const observer of observers) this.#notify(() => observer.error?.(error));
  }

  complete(): void {
    if (this.#closed) return;
    this.#closed = true;
    const observers = [...this.#observers];
    this.#observers.clear();
    for (const observer of observers) this.#notify(() => observer.complete?.());
  }

  subscribe(observer: Observer<T> | ((value: T) => void)): Subscription {
    const sink = typeof observer === 'function' ? {next: observer} : observer;
    if (this.#closed) {
      if (this.#failed) this.#notify(() => sink.error?.(this.#error));
      else this.#notify(() => sink.complete?.());
      return NOOP;
    }
    this.#observers.add(sink);
    return {unsubscribe: () => void this.#observers.delete(sink)};
  }

  [OBSERVABLE]() {
    return this;
  }

  async* [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    let queue: (T | undefined)[] = [];
    let head = 0;
    let wake: (() => void) | null = null;
    let done = false;
    let failure: any = null;
    let failed = false;

    const subscription = this.subscribe({
      next: value => {
        if (queue.length - head >= this.#maxBufferedChunks) {
          failure = new RangeError('Async iterator exceeded maxBufferedChunks');
          failed = done = true;
          queue = [];
          head = 0;
          subscription.unsubscribe();
          wake?.();
          return;
        }
        queue.push(value);
        wake?.();
      },
      error: error => {
        failure = error;
        failed = true;
        done = true;
        queue = [];
        head = 0;
        wake?.();
      },
      complete: () => {
        done = true;
        wake?.();
      },
    });

    try {
      for (; ;) {
        if (failed) throw failure;
        if (head < queue.length) {
          const value = queue[head]!;
          queue[head++] = undefined;
          if (head >= 1024 && head * 2 >= queue.length) {
            queue = queue.slice(head);
            head = 0;
          }
          yield value;
          continue;
        }
        // drained: reset instead of shift(), which is O(n) on a long queue
        if (head) {
          queue = [];
          head = 0;
        }
        if (done) return;
        await new Promise<void>(resolve => (wake = resolve));
        wake = null;
      }
    } finally {
      subscription.unsubscribe();
    }
  }
}

/** Resolves with the first value, rejects if the source ends without one. */
export function firstValue<T>(source: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let subscription: Subscription | null = null;
    let settled = false;
    subscription = source.subscribe({
      next: value => {
        settled = true;
        resolve(value);
        subscription?.unsubscribe();
      },
      error: reject,
      complete: () => {
        if (!settled) reject(new Error('Source completed without emitting a value'));
      },
    });
    if (settled) subscription.unsubscribe();
  });
}

/** Web stream over a source, for `pipeTo` and friends. No backpressure: the parser cannot pause. */
export function toReadableStream<T>(source: Observable<T>, maxBufferedChunks = Infinity): ReadableStream<T> {
  validateBufferLimit(maxBufferedChunks);
  let subscription: Subscription | null = null;
  let overflow = false;
  return new ReadableStream<T>({
    start(controller) {
      subscription = source.subscribe({
        next: value => {
          if (overflow) return;
          if (maxBufferedChunks !== Infinity && controller.desiredSize! <= 0) {
            overflow = true;
            controller.error(new RangeError('ReadableStream exceeded maxBufferedChunks'));
            subscription?.unsubscribe();
            return;
          }
          controller.enqueue(value);
        },
        error: error => controller.error(error),
        complete: () => { if (!overflow) controller.close(); },
      });
      if (overflow) subscription.unsubscribe();
    },
    cancel() {
      subscription?.unsubscribe();
    },
  }, {highWaterMark: maxBufferedChunks === Infinity ? 1 : maxBufferedChunks});
}

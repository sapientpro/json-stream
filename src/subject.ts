export type Observer<T> = {
  next?: (value: T) => void;
  error?: (error: any) => void;
  complete?: () => void;
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

  get closed(): boolean {
    return this.#closed;
  }

  next(value: T): void {
    if (this.#closed) return;
    for (const observer of this.#observers) observer.next?.(value);
  }

  error(error: any): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#error = error;
    const observers = [...this.#observers];
    this.#observers.clear();
    for (const observer of observers) observer.error?.(error);
  }

  complete(): void {
    if (this.#closed) return;
    this.#closed = true;
    const observers = [...this.#observers];
    this.#observers.clear();
    for (const observer of observers) observer.complete?.();
  }

  subscribe(observer: Observer<T> | ((value: T) => void)): Subscription {
    const sink = typeof observer === 'function' ? {next: observer} : observer;
    if (this.#closed) {
      if (this.#error) sink.error?.(this.#error);
      else sink.complete?.();
      return NOOP;
    }
    this.#observers.add(sink);
    return {unsubscribe: () => void this.#observers.delete(sink)};
  }

  [OBSERVABLE]() {
    return this;
  }

  async* [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    let queue: T[] = [];
    let head = 0;
    let wake: (() => void) | null = null;
    let done = false;
    let failure: any = null;

    const subscription = this.subscribe({
      next: value => {
        queue.push(value);
        wake?.();
      },
      error: error => {
        failure = error;
        done = true;
        wake?.();
      },
      complete: () => {
        done = true;
        wake?.();
      },
    });

    try {
      for (; ;) {
        if (head < queue.length) {
          yield queue[head++]!;
          continue;
        }
        // drained: reset instead of shift(), which is O(n) on a long queue
        if (head) {
          queue = [];
          head = 0;
        }
        if (failure) throw failure;
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
export function toReadableStream<T>(source: Observable<T>): ReadableStream<T> {
  let subscription: Subscription | null = null;
  return new ReadableStream<T>({
    start(controller) {
      subscription = source.subscribe({
        next: value => controller.enqueue(value),
        error: error => controller.error(error),
        complete: () => controller.close(),
      });
    },
    cancel() {
      subscription?.unsubscribe();
    },
  });
}

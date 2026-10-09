import type { CallbackObserver, PathSegment, Subscription } from './types.js';
export function validateBufferLimit(limit: number): void { if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1))
    throw new RangeError('maxBufferedChunks must be a positive safe integer or Infinity'); }
export function makeErrorReporter(handler?: (error: unknown) => void): (error: unknown) => void { return error => { if (!handler) {
    queueMicrotask(() => { throw error; });
    return;
} try {
    handler(error);
}
catch (nested) {
    queueMicrotask(() => { throw nested; });
} }; }
export class CallbackChannel<T> {
    #sinks: {
        observer: CallbackObserver<T> | null;
        active: boolean;
    }[] = [];
    #closed = false;
    #count = 0;
    constructor(private readonly report: (error: unknown) => void) { }
    get closed(): boolean { return this.#closed; }
    get observed(): boolean { return this.#count > 0; }
    add(observer: CallbackObserver<T>): {
        unsubscribe(): void;
    } {
        if (this.#closed)
            throw new Error('Callback channel is closed');
        const sink: {
            observer: CallbackObserver<T> | null;
            active: boolean;
        } = { observer, active: true };
        this.#sinks.push(sink);
        ++this.#count;
        return { unsubscribe: () => { if (sink.active) {
                sink.active = false;
                sink.observer = null;
                if (!this.#closed) {
                    --this.#count;
                    if (!this.#count)
                        this.#sinks = [];
                }
            } } };
    }
    next(value: T, path: readonly PathSegment[]): void {
        if (this.#closed)
            return;
        const sinks = this.#sinks;
        for (let i = 0; i < sinks.length && !this.#closed; ++i) {
            const sink = sinks[i]!;
            if (sink.active) {
                try {
                    sink.observer?.next(value, path);
                }
                catch (error) {
                    this.report(error);
                }
            }
        }
    }
    end(path: readonly PathSegment[]): void {
        if (this.#closed)
            return;
        for (const sink of this.#sinks)
            if (sink.active) {
                try {
                    sink.observer?.end?.(path);
                }
                catch (e) {
                    this.report(e);
                }
            }
    }
    error(error: unknown): void { this.#finish(true, error); }
    complete(): void { this.#finish(false, undefined); }
    #finish(failed: boolean, error: unknown): void {
        if (this.#closed)
            return;
        this.#closed = true;
        const sinks = this.#sinks;
        this.#sinks = [];
        this.#count = 0;
        for (const sink of sinks)
            if (sink.active) {
                sink.active = false;
                const observer = sink.observer;
                sink.observer = null;
                try {
                    if (failed)
                        observer?.error?.(error);
                    else
                        observer?.complete?.();
                }
                catch (e) {
                    this.report(e);
                }
            }
    }
}

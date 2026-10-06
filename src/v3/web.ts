import type { InputSink, Parser, PathInput, Subscription } from './types.js';
import { validateBufferLimit } from './channel.js';
/** A synchronous parser sink. Producers control when each write is submitted. */
export function createWritableStream(parser: InputSink): WritableStream<string | Uint8Array> {
    let target: InputSink | undefined = parser;
    return new WritableStream({
        write(chunk) { target!.write(chunk); },
        close() { const active = target!; target = undefined; active.end(); },
        abort(reason) { const active = target; target = undefined; active?.destroy(reason instanceof Error ? reason : new Error(String(reason))); },
    });
}
/** Cancellation and queue overflow unsubscribe only this string consumer. */
export function createStringStream(parser: Pick<Parser, 'onString'>, path: PathInput, maxBufferedChunks = Infinity): ReadableStream<string> {
    validateBufferLimit(maxBufferedChunks);
    let controller!: ReadableStreamDefaultController<string>;
    let subscription: Subscription | undefined;
    let closed = false;
    const stream = new ReadableStream<string>({
        start(target) { controller = target; },
        cancel() { closed = true; subscription?.unsubscribe(); subscription = undefined; },
    });
    subscription = parser.onString(path, {
        next(chunk) {
            if (closed)
                return;
            const queued = Math.max(0, 1 - (controller.desiredSize ?? 0));
            if (queued >= maxBufferedChunks) {
                closed = true;
                controller.error(new RangeError('String stream buffer limit exceeded'));
                subscription?.unsubscribe();
                subscription = undefined;
                return;
            }
            controller.enqueue(chunk);
        },
        error(error) {
            if (!closed) {
                closed = true;
                controller.error(error);
            }
            subscription?.unsubscribe();
            subscription = undefined;
        },
        complete() {
            if (!closed) {
                closed = true;
                controller.close();
            }
            subscription?.unsubscribe();
            subscription = undefined;
        },
    });
    return stream;
}

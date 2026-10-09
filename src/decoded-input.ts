import type { InputSink, ByteInputSink } from './types.js';

// Framing adapters already own decoding, including JSONL's fatal UTF-8 policy.
export const BYTE_INPUT = Symbol('byte-input');

/** One transport owns one decoder, including its EOF flush and cancellation. */
export function createDecodedInput(target: InputSink): ByteInputSink {
    if ((target as InputSink & { [BYTE_INPUT]?: boolean })[BYTE_INPUT])
        return target as ByteInputSink;
    let decoder: InstanceType<typeof TextDecoder> | undefined;
    let mode: 'text' | 'bytes' | undefined;
    let closed = false;
    let running = false;
    let failure: { error: unknown } | undefined;
    return {
        write(chunk) {
            if (running) throw new Error('write() re-entered');
            if (failure) throw failure.error;
            if (closed) throw new Error('Input is closed');
            const nextMode = typeof chunk === 'string' ? 'text' : 'bytes';
            if (mode && mode !== nextMode) throw new TypeError('Do not mix text and byte input');
            if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array))
                throw new TypeError('Input must be a string or Uint8Array');
            mode = nextMode;
            running = true;
            try {
                target.write(
                    typeof chunk === 'string'
                        ? chunk
                        : (decoder ??= new TextDecoder('utf-8', {
                              fatal: true,
                              ignoreBOM: true,
                          })).decode(chunk, { stream: true }),
                );
            } catch (error) {
                failure = { error };
                decoder = undefined;
                closed = true;
                target.destroy(error as Error);
                throw error;
            } finally {
                running = false;
            }
        },
        end() {
            if (running) throw new Error('end() re-entered');
            if (failure) throw failure.error;
            if (closed) return;
            running = true;
            try {
                const tail = decoder?.decode();
                if (tail) target.write(tail);
                target.end();
            } catch (error) {
                failure = { error };
                target.destroy(error as Error);
                throw error;
            } finally {
                running = false;
                closed = true;
                decoder = undefined;
            }
        },
        destroy(error) {
            // Forward destruction even after a failed write, so stream owners can clean up.
            if (error) failure ??= { error };
            closed = true;
            decoder = undefined;
            target.destroy(error);
        },
    };
}

import { BYTE_INPUT } from './decoded-input.js';
import type { InputSink, ByteInputSink } from './types.js';
import { createWritableStream } from './web.js';

/** Transport decoding and lifecycle shared by optional input framers only. */
export abstract class InputFramer implements ByteInputSink {
    readonly [BYTE_INPUT] = true;
    protected _closed = false;
    protected _finished = false;
    protected _started = false;
    private mode?: 'text' | 'bytes';
    private decoder?: InstanceType<typeof TextDecoder>;
    private running = false;
    private failure?: Error;
    private stream?: WritableStream<string | Uint8Array>;
    get closed(): boolean {
        return this._closed;
    }
    get finished(): boolean {
        return this._finished;
    }
    get writable(): WritableStream<string | Uint8Array> {
        return (this.stream ??= createWritableStream(this));
    }
    write(chunk: string | Uint8Array): void {
        this.check();
        const mode = typeof chunk === 'string' ? 'text' : 'bytes';
        if (this.mode && this.mode !== mode) throw new TypeError('Do not mix text and byte input');
        this.mode = mode;
        this._started = true;
        this.run(() =>
            this.consume(
                typeof chunk === 'string'
                    ? chunk
                    : (this.decoder ??= new TextDecoder('utf-8', {
                          ignoreBOM: true,
                          fatal: true,
                      })).decode(chunk, { stream: true }),
            ),
        );
    }
    end(): void {
        if (this.running) throw new Error('end() re-entered');
        if (this.failure) throw this.failure;
        if (this._closed) return;
        this._started = true;
        this.run(() => {
            const tail = this.decoder?.decode();
            if (tail) this.consume(tail);
            if (this._closed) return;
            this.finishInput();
            if (this._closed) return;
            this._finished = true;
            this._closed = true;
            this.decoder = undefined;
            this.terminate();
        });
    }
    destroy(error?: Error | null): void {
        if (this._closed) return;
        this.failure = error ?? undefined;
        this._closed = true;
        this.decoder = undefined;
        this.terminate(error ?? undefined);
    }
    private check(): void {
        if (this.running) throw new Error('write() re-entered');
        if (this.failure) throw this.failure;
        if (this._closed) throw new Error('Input is closed');
    }
    private run(action: () => void): void {
        this.running = true;
        try {
            action();
        } catch (reason) {
            const error = this.contextError(
                reason instanceof Error ? reason : new Error(String(reason)),
            );
            this.destroy(error);
            throw error;
        } finally {
            this.running = false;
        }
    }
    protected contextError(error: Error): Error {
        return error;
    }
    protected abstract consume(text: string): void;
    protected abstract finishInput(): void;
    protected abstract terminate(error?: Error): void;
}

/** Discard input through the first exact marker, then forward only the payload. */
export class PrefixFilter extends InputFramer {
    private tail = '';
    private found = false;
    constructor(
        private readonly target: InputSink,
        private readonly marker: string,
    ) {
        super();
        if (typeof marker !== 'string' || !marker.length)
            throw new TypeError('Prefix marker must be nonempty');
    }
    protected consume(text: string): void {
        if (this.found) {
            this.target.write(text);
            return;
        }
        const input = this.tail + text;
        const at = input.indexOf(this.marker);
        if (at < 0) {
            this.tail = input.slice(Math.max(0, input.length - this.marker.length + 1));
            return;
        }
        this.found = true;
        this.tail = '';
        this.target.write(input.slice(at + this.marker.length));
    }
    protected finishInput(): void {
        if (!this.found) throw new SyntaxError('Prefix marker not found');
        this.target.end();
    }
    protected terminate(error?: Error): void {
        this.tail = '';
        this.target.destroy(error);
    }
}

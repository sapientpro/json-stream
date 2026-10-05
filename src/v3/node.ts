import { Writable } from 'node:stream';
import { createParser } from './index.js';
import type { InputSink, Parser, FormatOptions, PathInput, ValueCallback, CallbackObserver, Subscription } from './types.js';
export * from './index.js';
/** The Node wrapper adds transport pacing; parsing and callbacks stay synchronous. */
export function createNodeWritable(parser: InputSink): Writable {
    return new Writable({
        decodeStrings: false,
        write(chunk: string | Buffer, _encoding, done) {
            try {
                parser.write(chunk);
                done();
            }
            catch (error) {
                done(error as Error);
            }
        },
        final(done) {
            try {
                parser.end();
                done();
            }
            catch (error) {
                done(error as Error);
            }
        },
        destroy(error, done) { parser.destroy(error); done(error); },
    });
}
export class JsonStream extends Writable {
    readonly #parser: Parser;
    constructor(options: FormatOptions = {}) {
        const parser = createParser(options);
        let valueSubscription: Subscription | undefined;
        let pending = false, pendingValue: any, inputStarted = false;
        const emitValue = () => {
            if (pending && parser.rootReady) {
                const value = pendingValue;
                pending = false; pendingValue = undefined;
                this.emit('value', value);
            }
        };
        super({
            decodeStrings: false,
            write: (chunk: string | Buffer, _encoding, done) => {
                try {
                    inputStarted = true;
                    parser.write(chunk);
                    emitValue();
                    done();
                }
                catch (error) {
                    done(error as Error);
                }
            },
            final: done => {
                try {
                    inputStarted = true;
                    parser.end();
                    emitValue();
                    done();
                }
                catch (error) {
                    done(error as Error);
                }
            },
            destroy: (error, done) => { pending = false; pendingValue = undefined; parser.destroy(error); done(error); },
        });
        this.#parser = parser;
        // A Node value listener is an explicit subscription to the root value.
        this.on('newListener', event => {
            if (event === 'value' && inputStarted)
                throw new Error('Register value listeners before the first write');
            if (event === 'value' && !valueSubscription)
                valueSubscription = parser.onValue('$', value => { pendingValue = value; pending = true; });
        });
        this.on('removeListener', event => {
            if (event === 'value' && !this.listenerCount('value')) {
                valueSubscription?.unsubscribe(); valueSubscription = undefined;
                pending = false; pendingValue = undefined;
            }
        });
    }
    get rootReady(): boolean { return this.#parser.rootReady; }
    get json(): string { return this.#parser.json; }
    get parsed(): boolean { return this.#parser.finished; }
    onValue<T = any>(path: PathInput, callback: ValueCallback<T> | CallbackObserver<T>): Subscription { return this.#parser.onValue(path, callback); }
    onString(path: PathInput, callback: ValueCallback<string> | CallbackObserver<string>): Subscription { return this.#parser.onString(path, callback); }
    getValue<T = any>(path: PathInput = '$'): Promise<T> { return this.#parser.getValue(path); }
    stringStream(path: PathInput): ReadableStream<string> { return this.#parser.stringStream(path); }
}

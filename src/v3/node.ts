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
        super({
            decodeStrings: false,
            write: (chunk: string | Buffer, _encoding, done) => {
                try {
                    const ready = parser.rootReady;
                    parser.write(chunk);
                    if (!ready && parser.rootReady)
                        this.emit('value', parser.root);
                    done();
                }
                catch (error) {
                    done(error as Error);
                }
            },
            final: done => {
                try {
                    const ready = parser.rootReady;
                    parser.end();
                    if (!ready && parser.rootReady)
                        this.emit('value', parser.root);
                    done();
                }
                catch (error) {
                    done(error as Error);
                }
            },
            destroy: (error, done) => { parser.destroy(error); done(error); },
        });
        this.#parser = parser;
    }
    get root(): any { return this.#parser.root; }
    get rootReady(): boolean { return this.#parser.rootReady; }
    get json(): string { return this.#parser.json; }
    get parsed(): boolean { return this.#parser.finished; }
    onValue<T = any>(path: PathInput, callback: ValueCallback<T> | CallbackObserver<T>): Subscription { return this.#parser.onValue(path, callback); }
    onString(path: PathInput, callback: ValueCallback<string> | CallbackObserver<string>): Subscription { return this.#parser.onString(path, callback); }
    getValue<T = any>(path: PathInput = []): Promise<T> { return this.#parser.getValue(path); }
    onValueJsonPath<T = any>(query: string, callback: ValueCallback<T> | CallbackObserver<T>): Subscription { return this.#parser.onValueJsonPath(query, callback); }
    onStringJsonPath(query: string, callback: ValueCallback<string> | CallbackObserver<string>): Subscription { return this.#parser.onStringJsonPath(query, callback); }
    getValueJsonPath<T = any>(query: string): Promise<T> { return this.#parser.getValueJsonPath(query); }
    stringStream(path: PathInput): ReadableStream<string> { return this.#parser.stringStream(path); }
}

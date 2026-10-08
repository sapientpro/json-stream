import {JsonScanner} from './json-scanner.js';
import {Json5Scanner} from './json5-scanner.js';
import {createStringStream, createWritableStream} from './web.js';
import type {CallbackObserver, FormatOptions, Parser, PathInput, Subscription, ValueCallback} from './types.js';

export type CopyingParserOptions = FormatOptions & {
    /** Copy scalar strings/fragments up to this many UTF-16 units. Default 128. */
    maxCopyLength?: number;
    /** Enable copying after seeing an input chunk at least this large. Default 65536. */
    minInputLength?: number;
};

/** An opt-in consumer facade; the underlying scanner is unchanged. */
class CopyingParser implements Parser {
    #parser: Parser;
    #largeInput = false;
    #maxCopyLength: number;
    #minInputLength: number;
    #bufferLimit: number | undefined;
    #writable: WritableStream<string | Uint8Array> | null = null;

    constructor({maxCopyLength = 128, minInputLength = 65536, format = 'json', ...options}: CopyingParserOptions) {
        for (const [name, limit] of [['maxCopyLength', maxCopyLength], ['minInputLength', minInputLength]] as const) {
            if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(name + ' must be a positive safe integer');
        }
        if (format === 'json') this.#parser = new JsonScanner(options);
        else if (format === 'json5') this.#parser = new Json5Scanner(options);
        else throw new TypeError('Unsupported input format: ' + format);
        this.#maxCopyLength = maxCopyLength;
        this.#minInputLength = minInputLength;
        this.#bufferLimit = options.maxBufferedChunks;
    }

    #copy<T>(value: T): T {
        return this.#largeInput && typeof value === 'string' && value.length <= this.#maxCopyLength
            ? copyString(value) as T : value;
    }

    #observer<T>(consumer: ValueCallback<T> | CallbackObserver<T>): ValueCallback<T> | CallbackObserver<T> {
        if (typeof consumer === 'function') return (value, path) => consumer(this.#copy(value), path);
        // Preserve the base parser's validation for invalid JavaScript callers.
        if (!consumer || typeof consumer.next !== 'function') return consumer;
        return {
            next: (value, path) => consumer.next(this.#copy(value), path),
            end: path => consumer.end?.(path),
            error: error => consumer.error?.(error),
            complete: () => consumer.complete?.(),
        };
    }

    onValue<T = any>(path: PathInput, consumer: ValueCallback<T> | CallbackObserver<T>): Subscription {
        return this.#parser.onValue(path, this.#observer(consumer));
    }
    onString(path: PathInput, consumer: ValueCallback<string> | CallbackObserver<string>): Subscription {
        return this.#parser.onString(path, this.#observer(consumer));
    }
    getValue<T = any>(path: PathInput = '$'): Promise<T> {
        return new Promise((resolve, reject) => {
            let subscription: Subscription;
            subscription = this.onValue<T>(path, {
                next: value => {subscription.unsubscribe(); resolve(value);},
                error: reject,
                complete: () => reject(new Error('No value matched the selector')),
            });
        });
    }
    stringStream(path: PathInput): ReadableStream<string> {
        return createStringStream(this, path, this.#bufferLimit);
    }
    get writable(): WritableStream<string | Uint8Array> { return this.#writable ??= createWritableStream(this); }
    get finished(): boolean { return this.#parser.finished; }
    get rootReady(): boolean { return this.#parser.rootReady; }
    get closed(): boolean { return this.#parser.closed; }
    get json(): string { return this.#parser.json; }
    write(chunk: string): void {
        if (chunk.length >= this.#minInputLength) this.#largeInput = true;
        this.#parser.write(chunk);
    }
    end(): void { this.#parser.end(); }
    reset(): void {
        this.#parser.reset();
        this.#largeInput = false;
    }
    destroy(error?: Error | null): void { this.#parser.destroy(error); }
}

/** Copy only short top-level scalar results and fragments, after large input writes.
 * Objects and longer strings pass through unchanged. This is not a deep-copy API.
 */
export function createCopyingParser(options: CopyingParserOptions = {}): Parser {
    return new CopyingParser(options);
}

/** Two nonempty join parts allocate independent character storage on tested engines. */
function copyString(value: string): string {
    const length = value.length;
    if (length === 0) return '';
    if (length === 1) return String.fromCharCode(value.charCodeAt(0));
    return [value.slice(0, 1), value.slice(1)].join('');
}

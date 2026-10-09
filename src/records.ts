import { DOCUMENT_INPUT } from './document-input.js';
import { JsonScanner } from './json-scanner.js';
import { Json5Scanner } from './json5-scanner.js';
import { InputFramer } from './framing.js';
import { createStringStream } from './web.js';
import { compileJsonPath } from './jsonpath.js';
import { makeErrorReporter } from './channel.js';
import type { FormatOptions, PathInput, PathSegment, Subscription } from './types.js';

export type RecordCallback<T> = (value: T, path: readonly PathSegment[], recordIndex: number) => void;
export type RecordObserver<T> = {
    next: RecordCallback<T>;
    end?: (path: readonly PathSegment[], recordIndex: number) => void;
    error?: (error: unknown) => void;
    complete?: () => void;
};
type Binding = {
    active: boolean;
    path: PathInput;
    fragments: boolean;
    observer: RecordObserver<any> | null;
    current?: Subscription;
};

/** Persistent consumer bindings and parser state reset at each record boundary. */
abstract class RecordManager extends InputFramer {
    private bindings: Binding[] = [];
    private readonly report: (error: unknown) => void;
    protected parser: JsonScanner | Json5Scanner | undefined;
    protected count = 0;
    protected touched = false;
    private bound = false;
    protected readonly options: FormatOptions;
    constructor(options: FormatOptions = {}, fatalUtf8 = true) {
        super(fatalUtf8);
        this.options = {...options};
        this.report = makeErrorReporter(options.onObserverError);
        // Validate options eagerly, then reuse this instance for the first record.
        this.parser = this.newParser();
    }
    get recordCount(): number { return this.count; }
    onValue<T = any>(path: PathInput, callback: RecordCallback<T> | RecordObserver<T>): Subscription {
        return this.register(path, callback, false);
    }
    onString(path: PathInput, callback: RecordCallback<string> | RecordObserver<string>): Subscription {
        return this.register(path, callback, true);
    }
    onRecord<T = any>(callback: (value: T, recordIndex: number) => void): Subscription {
        return this.onValue<T>([], (value, _path, index) => callback(value, index));
    }
    getValue<T = any>(path: PathInput = '$'): Promise<T> {
        return new Promise((resolve, reject) => {
            let subscription: Subscription;
            subscription = this.onValue<T>(path, {
                next: value => { subscription.unsubscribe(); resolve(value); },
                error: reject,
                complete: () => reject(new Error('No value matched the selector')),
            });
        });
    }
    stringStream(path: PathInput): ReadableStream<string> {
        return createStringStream(this, path, this.options.maxBufferedChunks);
    }
    private register<T>(path: PathInput, callback: RecordCallback<T> | RecordObserver<T>, fragments: boolean): Subscription {
        if (this._started || this._closed) throw new Error('Register callbacks before the first write');
        const observer = typeof callback === 'function' ? {next: callback} : callback;
        if (!observer || typeof observer.next !== 'function') throw new TypeError('A next callback is required');
        const saved = typeof path === 'string' ? compileJsonPath(path) : [...path];
        // Use the parser's selector validation; it has not consumed any input yet.
        const validation = fragments ? this.parser!.onString(saved, () => {}) : this.parser!.onValue(saved, () => {});
        validation.unsubscribe();
        const binding: Binding = {active: true, path: saved, fragments, observer};
        this.bindings.push(binding);
        return {unsubscribe: () => {
            binding.active = false;
            binding.current?.unsubscribe();
            binding.current = undefined;
            binding.observer = null;
        }};
    }
    private newParser(): JsonScanner | Json5Scanner {
        const {format = 'json', ...options} = this.options;
        if (format === 'json') return new JsonScanner(options);
        if (format === 'json5') return new Json5Scanner(options);
        throw new TypeError('Unsupported input format: ' + format);
    }
    protected activeParser(): JsonScanner | Json5Scanner {
        if (!this.touched) {
            this.parser ??= this.newParser();
            if (!this.bound) for (const binding of this.bindings) {
                if (!binding.active) continue;
                const observer = {
                    next: (value: any, path: readonly PathSegment[]) => {
                        if (!this._closed && binding.active) binding.observer?.next(value, path, this.count);
                    },
                    end: (path: readonly PathSegment[]) => {
                        if (!this._closed && binding.active) binding.observer?.end?.(path, this.count);
                    },
                };
                binding.current = binding.fragments ? this.parser.onString(binding.path, observer) : this.parser.onValue(binding.path, observer);
            }
            this.bound = true;
            this.touched = true;
        }
        return this.parser!;
    }
    protected finishRecord(): void {
        const parser = this.activeParser();
        parser.reset();
        if (this._closed) return;
        ++this.count;
        this.touched = false;
    }
    protected terminate(error?: Error): void {
        const parser = this.parser;
        this.parser = undefined;
        parser?.destroy(error);
        const bindings = this.bindings;
        this.bindings = [];
        for (const binding of bindings) {
            binding.current = undefined;
            if (!binding.active) continue;
            binding.active = false;
            const observer = binding.observer;
            binding.observer = null;
            try {
                if (error) observer?.error?.(error);
                else observer?.complete?.();
            }
            catch (reason) { this.report(reason); }
        }
    }
}

/** LF-framed values. JSON5 is an explicit single-physical-line extension. */
export class JsonLinesParser extends RecordManager {
    constructor(options: FormatOptions = {}) { super({...options, strictEnd: true}, true); }
    private first = true;
    protected consume(text: string): void {
        if (this.first && text.length) {
            this.first = false;
            if (text.charCodeAt(0) === 0xfeff) throw new SyntaxError('JSON Lines must not start with a BOM');
        }
        let pos = 0;
        while (pos < text.length && !this._closed) {
            const end = text.indexOf('\n', pos);
            const part = text.slice(pos, end < 0 ? text.length : end);
            if (part.length) this.activeParser().write(part);
            if (this._closed) return;
            if (end < 0) return;
            this.finishRecord();
            pos = end + 1;
        }
    }
    protected finishInput(): void { if (this.touched) this.finishRecord(); }
}

/** Seek an exact start marker for every JSON/JSON5 document. */
export class PrefixedJsonParser extends RecordManager {
    private tail = '';
    private seeking = true;
    constructor(private readonly marker: string, options: FormatOptions = {}) {
        super({...options, strictEnd: false});
        if (typeof marker !== 'string' || !marker.length) throw new TypeError('Prefix marker must be nonempty');
    }
    protected consume(text: string): void {
        // A split marker requires one bounded-prefix concatenation per input chunk.
        const input = this.tail + text;
        this.tail = '';
        let pos = 0;
        while (pos < input.length && !this._closed) {
            if (this.seeking) {
                const at = input.indexOf(this.marker, pos);
                if (at < 0) {
                    this.tail = input.slice(Math.max(pos, input.length - this.marker.length + 1));
                    return;
                }
                pos = at + this.marker.length;
                this.seeking = false;
                this.activeParser();
                if (pos === input.length) return;
            }
            const parser = this.activeParser();
            const unread = parser[DOCUMENT_INPUT](input, pos);
            if (this._closed) return;
            if (!parser.rootReady) return;
            this.finishRecord();
            this.seeking = true;
            pos = input.length - unread;
        }
    }
    protected finishInput(): void {
        if (!this.seeking) this.finishRecord();
        else if (!this.count) throw new SyntaxError('Prefix marker not found');
    }
    protected terminate(error?: Error): void { this.tail = ''; super.terminate(error); }
}

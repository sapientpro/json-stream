import { DOCUMENT_INPUT } from './document-input.js';
import {IS_V8} from './lexical.js';
import { Any, Rest } from './types.js';
import type { Path, PathInput, PathSegment, ParserOptions, CallbackOptions, ValueCallback, CallbackObserver, Subscription, Parser } from './types.js';
import { CopyingChannel } from './copy-channel.js';
import type { CopyPolicy } from './copy-channel.js';
import { CallbackChannel, makeErrorReporter, validateBufferLimit } from './channel.js';
import { EMPTY_CONTEXT, newNode, makeContext, stepContext, childrenOf } from './selectors.js';
import type { Node, Context, Frame } from './selectors.js';
import { State } from './state.js';
import { createWritableStream, createStringStream } from './web.js';
import { compileJsonPath } from './jsonpath.js';
const IS_BUN = typeof (globalThis as {Bun?: unknown}).Bun !== 'undefined';
/** Shared incremental builder and synchronous callback lifecycle. */
export abstract class ParserCore implements Parser {
    protected readonly _root: Node = newNode();
    protected _tracking = false;
    protected _retainAll = false;
    protected _rootContext!: Context;
    protected _context!: Context;
    protected readonly _collect: boolean;
    protected readonly _maxDepth: number;
    protected readonly _subjectOptions: CallbackOptions;
    protected _started = false;
    protected _buf = '';
    protected _pinned = 0;
    protected _snapshot: PathSegment[] | null = null;
    protected _pos = 0;
    protected _consumed = 0;
    protected _state: number;
    protected _stack: Frame[] = [];
    protected _path: PathSegment[] = [];
    protected _acc = '';
    protected _str = '';
    protected _parts: string[] | null = null;
    protected _hasChunks = false;
    protected _retainString = true;
    protected _strSinks: {
        subject: CallbackChannel<string>;
        path: readonly PathSegment[];
    }[] = [];
    protected _keyMode = false;
    protected _json = '';
    protected _done = false;
    protected _documentDone = false;
    protected _rootAvailable = false;
    protected _failure: Error | null = null;
    protected _writable: WritableStream<Uint8Array | string> | null = null;
    protected _running = false;
    protected readonly _framed: boolean = false;
    declare protected _copyPolicy: CopyPolicy | undefined;
    constructor(options: ParserOptions = {}) {
        if ('retainRoot' in options)
            throw new TypeError('retainRoot was removed; subscribe to $ for the complete value');
        const { collectJson = false, strictEnd = true, maxDepth = 1000, maxBufferedChunks = Infinity, onObserverError } = options;
        validateBufferLimit(maxBufferedChunks);
        this._subjectOptions = { maxBufferedChunks, onObserverError };
        this._reportCallback = makeErrorReporter(onObserverError);
        if (maxDepth !== Infinity && (!Number.isSafeInteger(maxDepth) || maxDepth < 0))
            throw new RangeError('maxDepth must be a nonnegative safe integer or Infinity');
        if (typeof strictEnd !== 'boolean') throw new TypeError('strictEnd must be a boolean');
        if (!strictEnd) {
            this._framed = true;
            this.write = this._writeManaged;
            this[DOCUMENT_INPUT] = this._writeManaged;
        }
        this._collect = collectJson;
        this._maxDepth = maxDepth;
        this._state = State.VALUE;
        const {memoryMode = 'fast'} = options;
        if (memoryMode !== 'fast' && memoryMode !== 'compact') throw new TypeError('Invalid memoryMode');
        if (memoryMode === 'compact') initializeCompact(this);
    }
    get json(): string {
        return this._json;
    }
    get finished(): boolean {
        return this._documentDone;
    }
    get rootReady(): boolean { return this._rootAvailable; }
    protected readonly _reportCallback: (error: unknown) => void;
    protected _register<T>(path: PathInput, callback: ValueCallback<T> | CallbackObserver<T>, fragments: boolean): {
        unsubscribe(): void;
    } {
        if (this._started || this._done || this._failure)
            throw new Error('Register callbacks before the first write');
        const segments = typeof path === 'string' ? compileJsonPath(path) : [...path];
        if (segments.some((key, i) => key === Rest && i !== segments.length - 1))
            throw new TypeError('Rest must be the last selector segment');
        const observer = typeof callback === 'function' ? { next: callback } : callback;
        if (!observer || typeof observer.next !== 'function')
            throw new TypeError('A next callback is required');
        const node = this._node(segments);
        if (fragments) {
            this._hasChunks = true;
            return (node.fragments ??= (this._copyPolicy ? new CopyingChannel<string>(this._reportCallback, this._copyPolicy) : new CallbackChannel<string>(this._reportCallback))).add(observer as CallbackObserver<string>);
        }
        return (node.callbacks ??= (this._copyPolicy ? new CopyingChannel<T>(this._reportCallback, this._copyPolicy) : new CallbackChannel<T>(this._reportCallback))).add(observer);
    }
    onValue<T = any>(path: PathInput, callback: ValueCallback<T> | CallbackObserver<T>): {
        unsubscribe(): void;
    } {
        return this._register(path, callback, false);
    }
    onString(path: PathInput, callback: ValueCallback<string> | CallbackObserver<string>): {
        unsubscribe(): void;
    } {
        return this._register(path, callback, true);
    }
    getValue<T = any>(path: PathInput = '$'): Promise<T> {
        return new Promise((resolve, reject) => {
            let subscription: {
                unsubscribe(): void;
            };
            subscription = this.onValue<T>(path, {
                next: value => { subscription.unsubscribe(); resolve(value); },
                error: reject,
                complete: () => reject(new Error('No value matched the selector')),
            });
        });
    }
    stringStream(path: PathInput): ReadableStream<string> { return createStringStream(this, path, this._subjectOptions.maxBufferedChunks); }
    get writable(): WritableStream<Uint8Array | string> { return this._writable ??= createWritableStream(this); }
    write(chunk: string): number;
    write(chunk: string, offset = -1): number {
        if (this._running)
            throw new Error('write() re-entered from an observer callback; use destroy() to stop');
        if (this._state === State.FAILED)
            throw this._failure!;
        if (this._done)
            throw new Error('Parser is closed');
        if (typeof chunk !== 'string') throw new TypeError('Parser input must be a string; use a stream wrapper for bytes');
        if (!this._started) {
            this._context = this._rootContext = makeContext([this._root]);
            this._tracking = this._rootContext !== EMPTY_CONTEXT;
            const rootOnly = !this._hasChunks && !this._root.any && !this._root.rest &&
                !Object.keys(this._root.children).length && !Object.keys(this._root.indexes).length;
            // Bun favors the ordinary builder for root-only callbacks; V8 favors substitution.
            if (!this._tracking || (rootOnly && IS_V8)) {
                this._tracking = false;
                this._retainAll = !!this._root.callbacks?.observed;
                this._emit = this._emitUnobserved;
                if (IS_V8) this._emitNumber = this._emitNumberUnobserved;
                this._open = this._openUnobserved;
                this._closeString = this._closeStringUnobserved;
                this._close = this._closeUnobserved;
            }
            if (IS_V8 && this._hasChunks)
                this._flushChunk = this._flushTextChunk;
        }
        this._started = true;
        const text = chunk;
        if (this._collect)
            this._json += offset > 0 ? text.slice(offset) : text;
        if (offset >= 0 && this._pos === this._buf.length) {
            this._consumed += this._pos - offset;
            this._buf = text;
            this._pos = offset;
        }
        else if (IS_BUN && text.length <= 128 && this._pos === this._buf.length) {
            // Small Bun writes avoid an empty slice/concat; large chunks keep their measured path.
            this._consumed += this._pos;
            this._buf = text;
            this._pos = 0;
        }
        else if (this._pos) {
            this._consumed += this._pos;
            this._buf = this._buf.slice(this._pos) + (offset > 0 ? text.slice(offset) : text);
            this._pos = 0;
        }
        else this._buf += offset > 0 ? text.slice(offset) : text;
        this._pinned = 0;
        this._running = true;
        try {
            this._run();
        }
        finally {
            this._running = false;
        }
        return 0;
    }
    /** Only non-strict instances use this entry point; strict writes keep their hot path. */
    protected _writeManaged(chunk: string, offset = -1): number {
        if (this._rootAvailable && !this._running && !this.closed)
            throw new Error('Document is complete; call reset() before write()');
        (ParserCore.prototype.write as (chunk: string, offset: number) => number).call(this, chunk, offset);
        if (!this._rootAvailable || this.closed) return 0;
        const unread = this._buf.length - this._pos;
        if (this._collect && unread) this._json = this._json.slice(0, -unread);
        this._consumed += this._pos;
        this._buf = '';
        this._pos = 0;
        return unread;
    }
    /** Managers reuse the original string to avoid repeated suffix copies on Bun. */
    [DOCUMENT_INPUT](text: string, offset: number): number {
        return (this.write as (chunk: string, offset: number) => number)(text, offset);
    }
    end(chunk?: string): number {
        const unread = chunk === undefined ? 0 : this.write(chunk);
        this._finishDocument(true);
        return unread;
    }
    private _finishDocument(close: boolean): void {
        if (this._running)
            throw new Error('end() re-entered');
        if (this._state === State.FAILED)
            throw this._failure!;
        if (this._done)
            return;
        this._eof = true;
        this._running = true;
        try {
            this._run();
            if (this.closed)
                return;
            this._finishInput();
            if (this.closed)
                return;
            if (this._state !== State.END || !this._validateEnd())
                this._fail(this._syntaxError());
            this._documentDone = true;
            if (close) this._complete();
        }
        finally {
            this._running = false;
        }
    }
    /** Validate this record and begin another while preserving active consumers. */
    reset(): void {
        if (this._running) throw new Error('reset() re-entered');
        if (this.closed) throw this._failure ?? new Error('Cannot reset a closed parser; use reset before end');
        this._finishDocument(false);
        if (this.closed) return;
        if (this._copyPolicy) this._copyPolicy.large = false;
        this._state = State.VALUE;
        this._documentDone = false;
        this._rootAvailable = false;
        this._buf = '';
        this._pos = this._consumed = this._pinned = 0;
        this._stack.length = this._path.length = 0;
        this._snapshot = null;
        this._acc = this._str = this._json = '';
        this._parts = null;
        this._strSinks.length = 0;
        this._keyMode = false;
        this._retainString = true;
        this._eof = false;
        this._context = this._rootContext;
        if (!this._tracking) this._retainAll = !!this._root.callbacks?.observed;
        this._resetScanner();
    }
    protected _resetScanner(): void { }
    destroy(error?: Error | null): void {
        if (error)
            this._fail(error, false);
        else
            this._complete();
    }
    protected _node(path: Path): Node {
        const segments = path;
        for (const key of segments) {
            if (typeof key === 'number' && (!Number.isSafeInteger(key) || key < 0))
                throw new TypeError('Array selectors must be nonnegative safe integers');
            if (typeof key !== 'number' && typeof key !== 'string' && key !== Any && key !== Rest)
                throw new TypeError('Invalid selector segment');
        }
        let node = this._root;
        for (const key of segments) {
            node = key === Any ? node.any ??= newNode()
                : key === Rest ? node.rest ??= newNode()
                    : typeof key === 'number' ? node.indexes[key] ??= newNode()
                        : node.children[key] ??= newNode();
            if (key === Rest)
                node.tail = true;
        }
        return node;
    }
    protected _syntaxError(): SyntaxError {
        return new SyntaxError('Json syntax error at ' + (this._consumed + this._pos));
    }
    protected _fail(error: Error, shouldThrow = true): never | void {
        if (this._state === State.FAILED || this._done)
            return;
        this._state = State.FAILED;
        this._failure = error;
        this._walk(this._root, node => {
            node.fragments?.error(error);
            node.callbacks?.error(error);
        });
        this._release();
        if (shouldThrow)
            throw error;
    }
    protected _complete(): void {
        if (this.closed)
            return;
        this._done = true;
        this._walk(this._root, node => {
            node.fragments?.complete();
            node.callbacks?.complete();
        });
        this._release();
    }
    protected _walk(node: Node, fn: (node: Node) => void): void { const pending = [node]; while (pending.length) {
        const next = pending.pop()!;
        fn(next);
        for (const child of childrenOf(next))
            pending.push(child);
    } }
    /** Selected once before parsing when no consumers need paths or selector contexts. */
    protected _emitUnobserved(value: any): void {
        const frame = this._stack[this._stack.length - 1];
        if (!frame) {
            if (this._rootContext !== EMPTY_CONTEXT)
                this._dispatch(this._root, value, 0);
            if (this.closed)
                return;
            this._state = State.END;
            this._rootAvailable = true;
        }
        else if (frame.isArray) {
            frame.container?.push(value);
            ++frame.count;
            this._state = State.ARR_NEXT;
        }
        else {
            if (frame.container !== undefined && frame.key === '__proto__') {
                Object.defineProperty(frame.container, frame.key, { value, enumerable: true, writable: true, configurable: true });
            }
            else if (frame.container !== undefined)
                frame.container[frame.key] = value;
            this._state = State.OBJ_NEXT;
        }
    }
    protected _openUnobserved(isArray: boolean): void {
        if (this._stack.length >= this._maxDepth)
            this._fail(new SyntaxError('Json nesting deeper than ' + this._maxDepth));
        this._stack.push({ container: this._retainAll ? (isArray ? [] : {}) : undefined,
            isArray, key: '', count: 0, context: EMPTY_CONTEXT, arrayContext: undefined });
        this._state = isArray ? State.VALUE : State.OBJ_FIRST;
    }
    protected _closeStringUnobserved(): void {
        const text = this._retainString ? (this._str.length < 13 ? this._str : this._flatten(this._str)) : undefined;
        this._str = '';
        if (this._keyMode) {
            this._stack[this._stack.length - 1]!.key = text!;
            this._state = State.COLON;
        }
        else
            this._emit(text);
    }
    protected _closeUnobserved(): void { this._emit(this._stack.pop()!.container); }
    protected _emit(value: any): void {
        this._snapshot = null;
        this._dispatch(this._root, value, 0);
        // an observer may have called destroy(); do not overwrite the terminal state
        if (this._state === State.FAILED || this._done)
            return;
        const frame = this._stack[this._stack.length - 1];
        if (!frame) {
            this._state = State.END;
            this._rootAvailable = true;
            return;
        }
        if (frame.isArray) {
            frame.container?.push(value);
            ++frame.count;
            if (frame.context !== EMPTY_CONTEXT)
                this._path[this._path.length - 1] = frame.count;
            this._state = State.ARR_NEXT;
        }
        else {
            // __proto__ is an accessor on Object.prototype; assigning would move the
            // prototype instead of creating an own property.
            if (frame.container !== undefined && frame.key === '__proto__') {
                Object.defineProperty(frame.container, frame.key, { value, enumerable: true, writable: true, configurable: true });
            }
            else if (frame.container !== undefined) {
                frame.container[frame.key] = value;
            }
            if (frame.context !== EMPTY_CONTEXT)
                this._path.pop();
            this._state = State.OBJ_NEXT;
        }
    }
    protected _emitNumber(buf: string, start: number, end: number): void {
        this._snapshot = null;
        let value: number | undefined;
        if (this._context !== EMPTY_CONTEXT && !this._done) for (const node of this._context.nodes) if (node.callbacks?.observed) {
            if (value === undefined) {value = Number(buf.slice(start, end));}
            node.callbacks.next(value, this._snapshot ??= this._path.slice());
        }
        // an observer may have called destroy(); do not overwrite the terminal state
        if (this._state === State.FAILED || this._done)
            return;
        const frame = this._stack[this._stack.length - 1];
        if (!frame) {
            this._state = State.END;
            this._rootAvailable = true;
            return;
        }
        if (frame.container !== undefined && value === undefined) {value = Number(buf.slice(start, end));}
        if (frame.isArray) {
            frame.container?.push(value);
            ++frame.count;
            if (frame.context !== EMPTY_CONTEXT)
                this._path[this._path.length - 1] = frame.count;
            this._state = State.ARR_NEXT;
        }
        else {
            // __proto__ is an accessor on Object.prototype; assigning would move the
            // prototype instead of creating an own property.
            if (frame.container !== undefined && frame.key === '__proto__') {
                Object.defineProperty(frame.container, frame.key, { value, enumerable: true, writable: true, configurable: true });
            }
            else if (frame.container !== undefined) {
                frame.container[frame.key] = value;
            }
            if (frame.context !== EMPTY_CONTEXT)
                this._path.pop();
            this._state = State.OBJ_NEXT;
        }
    }

    protected _emitNumberUnobserved(buf: string, start: number, end: number): void {
        let value: number | undefined;
        if (this._retainAll) {value = Number(buf.slice(start, end));}
        this._emitUnobserved(value);
    }
    protected _dispatch(_node: Node, value: any, _depth: number): void { if (this._context === EMPTY_CONTEXT || this._done)
        return; for (const node of this._context.nodes)
        if (node.callbacks?.observed)
            node.callbacks.next(value, this._snapshot ??= this._path.slice()); }
    protected _findChunkSinks(_node: Node, _depth: number): void { for (const node of this._context.nodes)
        if (node.fragments?.observed && !node.fragments.closed)
            this._strSinks.push({ subject: node.fragments, path: this._path.slice() }); }
    protected _hasValueSink(_node: Node, _depth: number): boolean { for (const node of this._context.nodes)
        if (node.callbacks?.observed)
            return true; return false; }
    protected _needsKey(): boolean { const frame = this._stack[this._stack.length - 1]!; return frame.container !== undefined || frame.context !== EMPTY_CONTEXT; }
    protected _shouldRetain(): boolean {
        if (this._stack[this._stack.length - 1]?.container !== undefined)
            return true;
        return this._hasValueSink(this._root, 0);
    }
    protected _open(isArray: boolean): void {
        if (this._stack.length >= this._maxDepth) {
            this._fail(new SyntaxError('Json nesting deeper than ' + this._maxDepth));
        }
        const container = this._shouldRetain() ? (isArray ? [] : {}) : undefined;
        this._stack.push({ container, isArray, key: '', count: 0, context: this._context, arrayContext: this._tracking && isArray && !this._context.indexed ? stepContext(this._context, 0) : undefined });
        if (isArray && this._context !== EMPTY_CONTEXT)
            this._path.push(0);
        this._state = isArray ? State.VALUE : State.OBJ_FIRST;
    }
    protected _close(): void {
        const frame = this._stack.pop()!;
        this._context = frame.context;
        if (frame.isArray && frame.context !== EMPTY_CONTEXT)
            this._path.pop();
        this._emit(frame.container);
    }
    protected _closeString(): void {
        let text: string | undefined;
        if (this._strSinks.length || this._parts !== null) {
            this._flushChunk(true);
            if (this._done || this._state === State.FAILED)
                return;
            text = this._retainString ? (this._parts?.join('') ?? '') + this._str : undefined;
            this._parts = null;
            for (const sink of this._strSinks) {
                sink.subject.end(sink.path);
            }
            this._strSinks.length = 0;
        }
        else {
            // Keys and ordinary values need no fragment array or final join.
            text = this._retainString ? this._flatten(this._str) : undefined;
        }
        this._str = '';
        if (this._done || this._state === State.FAILED)
            return;
        if (this._keyMode) {
            const frame = this._stack[this._stack.length - 1]!;
            frame.key = text!;
            if (frame.context !== EMPTY_CONTEXT)
                this._path.push(text!);
            this._state = State.COLON;
            return;
        }
        this._emit(text);
    }
    protected _eof = false;
    protected _flatten(text: string): string {
        if (text.length < 13 || this._buf.length - text.length <= 1024)
            return text;
        const copy = this._pinned * 4 < this._buf.length;
        this._pinned += text.length;
        return copy ? (' ' + text).slice(1) : text;
    }
    protected _flushChunk(final = false): void {
        for (let i = this._strSinks.length - 1; i >= 0; --i) {
            const channel = this._strSinks[i]!.subject;
            if (!channel.observed || channel.closed)
                this._strSinks.splice(i, 1);
        }
        if (!this._strSinks.length) {
            if (!this._retainString)
                this._str = '';
            return;
        }
        let end = this._str.length;
        // Retain only a trailing high surrogate until its partner arrives.
        if (!final && end) {
            const last = this._str.charCodeAt(end - 1);
            if (last >= 0xD800 && last <= 0xDBFF)
                --end;
        }
        if (!end)
            return;
        const chunk = this._str.slice(0, end);
        this._str = this._str.slice(end);
        if (this._retainString)
            (this._parts ??= []).push(chunk);
        for (const sink of this._strSinks) {
            sink.subject.next(chunk, sink.path);
        }
    }
    /** Selected once for V8 text input; prune and deliver in one pass. */
    protected _flushTextChunk(final = false): void {
        if (!this._strSinks.length) {
            if (!this._retainString)
                this._str = '';
            return;
        }
        let end = this._str.length;
        // Retain only a trailing high surrogate until its partner arrives.
        if (!final && end) {
            const last = this._str.charCodeAt(end - 1);
            if (last >= 0xD800 && last <= 0xDBFF)
                --end;
        }
        if (!end)
            return;
        const chunk = this._str.slice(0, end);
        this._str = this._str.slice(end);
        if (this._retainString)
            (this._parts ??= []).push(chunk);
        for (let i = 0; i < this._strSinks.length;) {
            const sink = this._strSinks[i]!;
            if (!sink.subject.observed || sink.subject.closed)
                this._strSinks.splice(i, 1);
            else {
                sink.subject.next(chunk, sink.path);
                ++i;
            }
        }
    }
    protected _release(): void { this._stack.length = 0; this._buf = ''; this._pos = 0; this._str = ''; this._parts = null; this._strSinks.length = 0; this._acc = ''; this._snapshot = null; this._path.length = 0; this._context = this._rootContext = EMPTY_CONTEXT; }
    protected abstract _run(): void;
    protected _finishInput(): void { }
    protected _validateEnd(): boolean { return true; }
    get closed(): boolean { return this._done || this._state === State.FAILED; }
}

/** Install compact input tracking once; ordinary writes have no policy branch. */
function initializeCompact(parser: ParserCore): void {
    // Keep compact allocation and method installation out of the ordinary constructor.
    const policy: CopyPolicy = (parser as unknown as {_copyPolicy: CopyPolicy})._copyPolicy = {large: false};
    const write = parser.write as (this: ParserCore, chunk: string, offset: number) => number;
    parser.write = function(chunk: string, offset = -1): number {
        if (typeof chunk === 'string' && chunk.length >= 65536) policy.large = true;
        return write.call(this, chunk, offset);
    };
    // Managed instances install a direct cursor entry; it must track compact input too.
    if (Object.hasOwn(parser, DOCUMENT_INPUT)) parser[DOCUMENT_INPUT] = parser.write;
}

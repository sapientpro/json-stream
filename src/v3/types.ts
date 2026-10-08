export const Any = Symbol.for('@sapientpro/json-stream/selector/any');
export const Rest = Symbol.for('@sapientpro/json-stream/selector/rest');
export type PathSegment = string | number;
export type Selector = PathSegment | typeof Any | typeof Rest;
export type Path = readonly Selector[];
/** A JSONPath string starting with $, or a typed array of property/index selectors. */
export type PathInput = string | Path;
export type Subscription = {
    unsubscribe(): void;
};
export type ValueCallback<T> = (value: T, path: readonly PathSegment[]) => void;
export type CallbackObserver<T> = {
    next: ValueCallback<T>;
    error?: (error: unknown) => void;
    complete?: () => void;
    end?: (path: readonly PathSegment[]) => void;
};
export type CallbackOptions = {
    maxBufferedChunks?: number;
    onObserverError?: (error: unknown) => void;
};
export type ParserOptions = CallbackOptions & {
    collectJson?: boolean;
    maxDepth?: number;
};
export type Format = 'json' | 'json5';
export type FormatOptions = ParserOptions & {
    format?: Format;
};
export interface InputSink {
    write(chunk: string): void;
    end(): void;
    destroy(error?: Error | null): void;
}
export interface ByteInputSink extends Omit<InputSink, 'write'> {
    write(chunk: string | Uint8Array): void;
}
export interface Parser extends InputSink {
    reset(): void;
    readonly rootReady: boolean;
    readonly finished: boolean;
    readonly closed: boolean;
    readonly json: string;
    readonly writable: WritableStream<string | Uint8Array>;
    write(chunk: string): void;
    end(): void;
    destroy(error?: Error | null): void;
    onValue<T = any>(path: PathInput, callback: ValueCallback<T> | CallbackObserver<T>): Subscription;
    onString(path: PathInput, callback: ValueCallback<string> | CallbackObserver<string>): Subscription;
    getValue<T = any>(path?: PathInput): Promise<T>;
    stringStream(path: PathInput): ReadableStream<string>;
}

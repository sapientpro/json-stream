export const Any = Symbol.for('@sapientpro/json-stream/selector/any');
export const Rest = Symbol.for('@sapientpro/json-stream/selector/rest');
export type PathSegment = string | number;
export type Selector = PathSegment | typeof Any | typeof Rest;
export type Path = readonly Selector[];
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
    retainRoot?: boolean;
};
export type Format = 'json' | 'json5';
export type FormatOptions = ParserOptions & {
    format?: Format;
};
export interface InputSink {
    write(chunk: string | Uint8Array): void;
    end(): void;
    destroy(error?: Error | null): void;
}
export interface Parser extends InputSink {
    reset(): void;
    readonly root: any;
    readonly rootReady: boolean;
    readonly finished: boolean;
    readonly closed: boolean;
    readonly json: string;
    readonly writable: WritableStream<string | Uint8Array>;
    write(chunk: string | Uint8Array): void;
    end(): void;
    destroy(error?: Error | null): void;
    onValue<T = any>(path: PathInput, callback: ValueCallback<T> | CallbackObserver<T>): Subscription;
    onString(path: PathInput, callback: ValueCallback<string> | CallbackObserver<string>): Subscription;
    getValue<T = any>(path?: PathInput): Promise<T>;
    onValueJsonPath<T = any>(query: string, callback: ValueCallback<T> | CallbackObserver<T>): Subscription;
    onStringJsonPath(query: string, callback: ValueCallback<string> | CallbackObserver<string>): Subscription;
    getValueJsonPath<T = any>(query: string): Promise<T>;
    stringStream(path: PathInput): ReadableStream<string>;
}

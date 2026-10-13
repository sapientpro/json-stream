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
/** Callbacks run synchronously; returned promises are neither awaited nor observed. */
export type CallbackObserver<T> = {
    next: ValueCallback<T>;
    error?: (error: unknown) => void;
    /** Once at successful input EOF, not after each selected value or record. */
    complete?: () => void;
    /** For onString only: once per matched string, including an empty string. */
    end?: (path: readonly PathSegment[]) => void;
};
export type CallbackOptions = {
    /** Pending fragments per output string stream; default Infinity. Not input backpressure. */
    maxBufferedChunks?: number;
    /** Handles synchronous observer throws, not async rejections. Default: microtask rethrow. */
    onObserverError?: (error: unknown) => void;
};
export type ParserOptions = CallbackOptions & {
    /** 'compact' copies short scalar results/fragments after large input writes, at a throughput cost.
     * Default 'fast'. Does not deep-copy containers, paths or collected JSON.
     */
    memoryMode?: 'fast' | 'compact';
    /** Retain decoded input in json; default false. Independent of value subscriptions. */
    collectJson?: boolean;
    /** Default true: validate all trailing input; false stops at the first complete document. */
    strictEnd?: boolean;
    /** Maximum container nesting; default 1000. A nonnegative safe integer or Infinity. */
    maxDepth?: number;
};
export type Format = 'json' | 'json5';
export type FormatOptions = ParserOptions & {
    /** Input grammar; default 'json'. Use with the factory, managers or Node wrapper. */
    format?: Format;
};
export interface InputSink {
    write(chunk: string): void;
    /** Consume an optional final text chunk, then validate and complete the input. */
    end(chunk?: string): void;
    destroy(error?: Error | null): void;
}
export interface ByteInputSink extends Omit<InputSink, 'write' | 'end'> {
    write(chunk: string | Uint8Array): void;
    /** Final chunk follows the same text/UTF-8 mode as write(); decoding is flushed at EOF. */
    end(chunk?: string | Uint8Array): void;
}
export interface Parser extends InputSink {
    /** Validate the current document and reuse active subscriptions; call before end(), never after. */
    reset(): void;
    /** Root structure is complete; trailing input and EOF may still fail validation. */
    readonly rootReady: boolean;
    /** Successful end() validation, including trailing input. */
    readonly finished: boolean;
    /** Input has ended, failed or been canceled. */
    readonly closed: boolean;
    /** Collected decoded input, or an empty string unless collectJson is enabled. */
    readonly json: string;
    /** UTF-8/text Web input; closes the parser at transport EOF. */
    readonly writable: WritableStream<string | Uint8Array>;
    /** Unconsumed UTF-16 units from this chunk; strict mode returns zero or throws. */
    write(chunk: string): number;
    /** Optional final text chunk, EOF validation, and its unconsumed tail count. */
    end(chunk?: string): number;
    destroy(error?: Error | null): void;
    /** Subscribe before input to complete selected values. T is not runtime validation. */
    onValue<T = any>(
        path: PathInput,
        callback: ValueCallback<T> | CallbackObserver<T>,
    ): Subscription;
    /** Subscribe before input to decoded string fragments; does not retain the complete string. */
    onString(
        path: PathInput,
        callback: ValueCallback<string> | CallbackObserver<string>,
    ): Subscription;
    /** First match, not validated document completion. Pending promises reject on failure or absence.
     * Register before input. T is a consumer type assertion, not runtime validation.
     */
    getValue<T = any>(path?: PathInput): Promise<T>;
    /** Concatenated matched fragments; cancellation unsubscribes only this consumer. */
    stringStream(path: PathInput): ReadableStream<string>;
}

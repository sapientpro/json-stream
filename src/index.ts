import { JsonScanner as JsonParser } from './json-scanner.js';
import { Json5Scanner as Json5Parser } from './json5-scanner.js';
import type { FormatOptions, Parser } from './types.js';
export { JsonParser, Json5Parser };
export { Any, Rest } from './types.js';
export { compileJsonPath } from './jsonpath.js';
export { createWritableStream, createStringStream } from './web.js';
export type { Parser, ParserOptions, FormatOptions, Format, Path, PathInput, PathSegment, Selector, ValueCallback, CallbackObserver, CallbackOptions, Subscription } from './types.js';
/** Pick the frontend once. No format checks are added to the plain JSON loop. */
export function createParser({ format = 'json', ...options }: FormatOptions = {}): Parser {
    if (format === 'json')
        return new JsonParser(options);
    if (format === 'json5')
        return new Json5Parser(options);
    throw new TypeError('Unsupported input format: ' + format);
}

export { PrefixFilter } from './framing.js';
export { JsonLinesParser, PrefixedJsonParser } from './records.js';
export type { RecordCallback, RecordObserver } from './records.js';
export type { InputSink } from './types.js';

export { createDecodedInput } from './decoded-input.js';
export type { ByteInputSink } from './types.js';

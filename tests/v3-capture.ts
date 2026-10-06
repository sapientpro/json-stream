import type {Parser} from '../src/v3/types';
const values = new WeakMap<object, unknown>();
/** Grammar tests explicitly subscribe to the root instead of relying on implicit retention. */
export function captureRoot<T extends Pick<Parser, 'onValue' | 'rootReady'>>(parser: T): T {
    parser.onValue('$', value => values.set(parser, value));
    return parser;
}
export function capturedRoot(parser: Pick<Parser, 'rootReady'>): any {
    return parser.rootReady ? values.get(parser) : undefined;
}

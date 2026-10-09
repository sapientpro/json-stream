import { createDecodedInput } from '../src/decoded-input';
import type { InputSink, ByteInputSink } from '../src/types';
// Each test transport owns one decoder, including its EOF flush.
const inputs = new WeakMap<InputSink, ByteInputSink>();
export function decodedInput(parser: InputSink): ByteInputSink {
    let input = inputs.get(parser);
    if (!input) { input = createDecodedInput(parser); inputs.set(parser, input); }
    return input;
}

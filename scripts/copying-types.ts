import {
    createParser,
    JsonParser,
    JsonLinesParser,
    PrefixedJsonParser,
    type FormatOptions,
} from '@sapientpro/json-stream';
import { Any, Rest, type Parser } from '@sapientpro/json-stream';

const options: FormatOptions = { format: 'json5', memoryMode: 'compact', maxBufferedChunks: 4 };
const parser: Parser = createParser(options);
parser.onValue<string>([Any, Rest], (value, path) => {
    const text: string = value;
    const concrete: readonly (string | number)[] = path;
    void text;
    void concrete;
});
const value: Promise<string> = parser.getValue<string>('$.text');
const writable: WritableStream<string | Uint8Array> = parser.writable;
void value;
void writable;
// @ts-expect-error only supported memory modes are accepted
createParser({ memoryMode: 'unknown' });
new JsonParser({ memoryMode: 'fast' });
new JsonLinesParser({ memoryMode: 'compact' });
new PrefixedJsonParser('@', { memoryMode: 'compact' });
// @ts-expect-error string consumers receive strings
parser.onString('$.text', (_value: number) => {});

// @ts-expect-error byte decoding belongs to transport adapters
parser.write(new Uint8Array());

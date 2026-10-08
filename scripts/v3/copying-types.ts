import {createCopyingParser, type CopyingParserOptions} from '@sapientpro/json-stream/copying';
import {Any, Rest, type Parser} from '@sapientpro/json-stream';

const options: CopyingParserOptions = {format:'json5',maxCopyLength:128,minInputLength:65536,maxBufferedChunks:4};
const parser: Parser = createCopyingParser(options);
parser.onValue<string>([Any, Rest], (value, path) => {
    const text: string = value;
    const concrete: readonly (string | number)[] = path;
});
const value: Promise<string> = parser.getValue<string>('$.text');
const writable: WritableStream<string | Uint8Array> = parser.writable;
// @ts-expect-error copying limits are numeric
createCopyingParser({maxCopyLength:'128'});
// @ts-expect-error string consumers receive strings
parser.onString('$.text', (value: number) => {});

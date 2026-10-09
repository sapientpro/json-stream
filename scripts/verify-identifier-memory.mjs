// Optional retained-heap diagnostic; never imported by the parser or throughput workers.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const module = pathToFileURL(path.resolve(process.argv[2] ?? 'dist/esm/index.js')).href;
const {Json5Parser} = await import(module);
const mode = process.argv[3] ?? 'reset';
if (!['reset', 'end', 'destroy', 'error'].includes(mode)) throw new Error('Unknown lifecycle mode');
const collect = typeof Bun !== 'undefined' ? () => Bun.gc(true) : globalThis.gc;
if (!collect) throw new Error('Use node --expose-gc or Bun for this diagnostic');
const held = [];
for (let i = 0; i < 3; i++) collect();
const before = process.memoryUsage();
function add(i) {
    const name = String.fromCharCode(65 + i) + 'LongIdentifierForMemory' + i;
    const text = '[{ignored:"' + 'x'.repeat(8 * 1024 * 1024) + '",'
        + name + ':1,\\u0041EscapedIdentifier:2}]';
    const parser = new Json5Parser();
    if (mode === 'error') {
        try {
            parser.write(text + '!');
            throw new Error('Expected a syntax error');
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
    } else {
        parser.write(text);
        parser[mode]();
    }
    held.push(parser);
}
for (let i = 0; i < 12; i++) add(i);
// Leave allocation stack frames before collecting, especially on Bun.
for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    collect();
}
const after = process.memoryUsage();
console.log(JSON.stringify({module, mode, parsers:held.length, inputMiB:96,
    retainedHeapMiB:(after.heapUsed - before.heapUsed) / 1048576,
    rssMiB:after.rss / 1048576, before, after}, null, 2));

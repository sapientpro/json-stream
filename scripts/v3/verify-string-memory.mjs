// Optional retained-memory diagnostic. Forced GC is never used by the parser.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {strictEqual} from 'node:assert';
const [format = 'json', input = 'text', scenario = 'none', lifecycle = 'end',
    module = 'dist/esm/v3/index.js'] = process.argv.slice(2);
if (!['json', 'json5'].includes(format) || !['text', 'bytes'].includes(input) ||
    !['none', 'root', 'selective', 'fragments', 'dense'].includes(scenario) ||
    !['end', 'reset', 'destroy', 'error'].includes(lifecycle)) throw Error('Unknown diagnostic option');
const {JsonParser, Json5Parser} = await import(pathToFileURL(path.resolve(module)));
const Parser = format === 'json' ? JsonParser : Json5Parser;
const collectGarbage = typeof Bun !== 'undefined' ? () => Bun.gc(true) : globalThis.gc;
if (!collectGarbage) throw Error('Run this diagnostic with node --expose-gc or Bun');
const parsers = [], outputs = [];
const collect = async () => {
    for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
        collectGarbage();
    }
    return process.memoryUsage();
};
const before = await collect();
let sampledHigh = {...before}, callbacks = 0;
function add(i) {
    const parser = new Parser();
    const selected = scenario === 'dense' ? 'y'.repeat(2 * 1024 * 1024)
        : 'small-selected-value-with-unicode-π😀-' + i;
    const save = value => {
        strictEqual(scenario === 'root' ? value.selected : value, selected);
        if (scenario === 'root') strictEqual(value.ignored.length, 8 * 1024 * 1024);
        outputs.push(value);
        ++callbacks;
    };
    if (scenario === 'root') parser.onValue('$', save);
    if (scenario === 'selective' || scenario === 'dense') parser.onValue('$.selected', save);
    if (scenario === 'fragments') parser.onString('$.selected', save);
    const text = '{"ignored":"' + 'x'.repeat(8 * 1024 * 1024) + '","selected":"' + selected + '"}';
    parser.write(input === 'bytes' ? new TextEncoder().encode(text) : text);
    if (lifecycle === 'error') {
        let failed = false;
        try { parser.write(input === 'bytes' ? new Uint8Array([33]) : '!'); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; failed = true; }
        strictEqual(failed, true);
    } else parser[lifecycle]();
    parsers.push(parser);
    const memory = process.memoryUsage();
    for (const key of Object.keys(sampledHigh)) sampledHigh[key] = Math.max(sampledHigh[key], memory[key]);
}
for (let i = 0; i < 4; i++) add(i);
strictEqual(callbacks, scenario === 'none' ? 0 : 4);
const retained = await collect();
outputs.length = 0;
const outputsDropped = await collect();
const delta = memory => Object.fromEntries(Object.keys(before).map(key => [key, (memory[key] - before[key]) / 1048576]));
console.log(JSON.stringify({runtime:typeof Bun === 'undefined' ? 'node' : 'bun', format, input, scenario,
    lifecycle, module, callbacks, parsers:parsers.length, ignoredInputMiB:32,
    retainedMiB:delta(retained), outputsDroppedMiB:delta(outputsDropped), sampledHighMiB:delta(sampledHigh)}, null, 2));

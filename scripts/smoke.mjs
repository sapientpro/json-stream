const capturedValues = new WeakMap();
const captureRoot = (parser) => {
    parser.onValue('$', (value) => capturedValues.set(parser, value));
    return parser;
};
const capturedRoot = (parser) => (parser.rootReady ? capturedValues.get(parser) : undefined);
import { deepStrictEqual, strictEqual, throws, rejects } from 'node:assert';
import { finished } from 'node:stream/promises';
const packageName = process.argv[2];
const { JsonParser, Json5Parser, createParser, Any, compileJsonPath, createDecodedInput } =
    await import(packageName ?? new URL('../dist/esm/index.js', import.meta.url).href);
const { JsonStream, createNodeWritable } = await import(
    packageName ? packageName + '/node' : new URL('../dist/esm/node.js', import.meta.url).href
);
for (const Parser of [JsonParser, Json5Parser]) {
    const p = new Parser({});
    const result = p.getValue('$.items[0].id'),
        values = [],
        fragments = [],
        ends = [];
    p.onValue(['items', Any, 'id'], (value, path) => values.push([value, path]));
    p.onString(['items', Any, 'text'], {
        next: (fragment, path) => fragments.push([fragment, path]),
        end: (path) => ends.push(path),
    });
    const bytes = new TextEncoder().encode(
        '{"items":[{"id":42,"text":"€😀"},{"id":43,"text":""}]}',
    );
    const input = createDecodedInput(p);
    for (const byte of bytes) input.write(Uint8Array.of(byte));
    input.end();
    strictEqual(await result, 42);
    deepStrictEqual(values, [
        [42, ['items', 0, 'id']],
        [43, ['items', 1, 'id']],
    ]);
    strictEqual(fragments.map(([v]) => v).join(''), '€😀');
    deepStrictEqual(ends, [
        ['items', 0, 'text'],
        ['items', 1, 'text'],
    ]);
    strictEqual(capturedRoot(p), undefined);
    strictEqual(p.finished, true);
    const strings = captureRoot(new Parser());
    const stream = strings.stringStream(['s']);
    strings.write('{"s":"hello');
    strings.write(' world"}');
    strings.end();
    let text = '';
    for await (const part of stream) text += part;
    strictEqual(text, 'hello world');
    const web = captureRoot(new Parser());
    await new ReadableStream({
        start(c) {
            c.enqueue(new TextEncoder().encode('[1,2]'));
            c.close();
        },
    }).pipeTo(web.writable);
    deepStrictEqual(capturedRoot(web), [1, 2]);
    const missing = captureRoot(new Parser());
    const value = missing.getValue(['missing']);
    const rejected = rejects(value, /No value/);
    missing.write('{}');
    missing.end();
    await rejected;
}
const json5 = captureRoot(createParser({ format: 'json5' }));
json5.write("/*x*/{key:'value',hex:0x10,n:NaN,}");
json5.end();
deepStrictEqual(capturedRoot(json5), { key: 'value', hex: 16, n: NaN });
const node = new JsonStream({ format: 'json5' }),
    events = [];
node.on('value', (v) => events.push(v));
const promise = node.getValue(['key']);
node.end("{key:'value'}");
await finished(node);
strictEqual(await promise, 'value');
strictEqual(events.length, 1);
const parser = captureRoot(new JsonParser());
const sink = createNodeWritable(parser);
sink.end(Buffer.from('42'));
await finished(sink);
strictEqual(capturedRoot(parser), 42);
throws(() => compileJsonPath('$[0:2]'), SyntaxError);
throws(() => captureRoot(new JsonParser()).write('[1,]'), SyntaxError);
console.log(
    'PASS: JSON/JSON5, typed selectors, first-match promises, owned paths, string boundaries, byte cuts, Web and Node wrappers, exports',
);

// Multi-document wrappers are part of the installed-package gate.
const { JsonLinesParser, PrefixedJsonParser, PrefixFilter } = await import(
    packageName ?? new URL('../dist/esm/index.js', import.meta.url).href
);
for (const manager of [new JsonLinesParser(), new PrefixedJsonParser('data:')]) {
    const roots = [];
    manager.onRecord((v, index) => roots.push([v, index]));
    const input = manager instanceof JsonLinesParser ? '1\n2' : 'data:1 data:2';
    const sink = createNodeWritable(manager);
    sink.end(new TextEncoder().encode(input));
    await finished(sink);
    deepStrictEqual(roots, [
        [1, 0],
        [2, 1],
    ]);
    strictEqual(manager.recordCount, 2);
}
const filtered = captureRoot(new JsonParser());
const filter = new PrefixFilter(filtered, 'BEGIN');
filter.write('noiseBEGIN{}');
filter.end();
deepStrictEqual(capturedRoot(filtered), {});
console.log('PASS: installed multi-document managers and prefix filter');

const reuse = captureRoot(new JsonParser());
const reusedValues = [];
reuse.onValue([], (v) => reusedValues.push(v));
reuse.write('1');
reuse.reset();
reuse.write('2');
reuse.end();
deepStrictEqual(reusedValues, [1, 2]);

throws(() => new JsonLinesParser().write(Uint8Array.of(0xff)));

const escapeStress = { s: 'x'.repeat(96) + '\\\n\t"😀'.repeat(200) };
const stressParser = captureRoot(new JsonParser());
let stressText = '';
stressParser.onString(['s'], (v) => (stressText += v));
const stressInput = JSON.stringify(escapeStress);
for (let pos = 0; pos < stressInput.length; pos += 512)
    stressParser.write(stressInput.slice(pos, pos + 512));
stressParser.end();
deepStrictEqual(capturedRoot(stressParser), escapeStress);
strictEqual(stressText, escapeStress.s);
console.log('PASS: complete escape runs and streaming fragments');

// Alternating sibling container types must preserve previously emitted roots.
for (const Parser of [JsonParser, Json5Parser]) {
    const tree = {
        items: [{ a: [1, { b: 2 }] }, [], { c: { d: [] } }, [{}, null, false]],
        last: {},
    };
    const reuse = captureRoot(new Parser());
    reuse.write(JSON.stringify(tree));
    const first = capturedRoot(reuse);
    reuse.reset();
    reuse.write('[{},[1,2],{"next":true},[]]');
    reuse.end();
    deepStrictEqual(first, tree);
    deepStrictEqual(capturedRoot(reuse), [{}, [1, 2], { next: true }, []]);
}

// Public document-boundary contract, including EOF chunks and root reuse.
for (const Parser of [JsonParser, Json5Parser]) {
    const p = new Parser({ strictEnd: false, collectJson: true }),
        values = [];
    p.onValue('$', (v) => values.push(v));
    strictEqual(p.write('{} tail'), 5);
    strictEqual(p.json, '{}');
    throws(() => p.write(''), /reset/);
    p.reset();
    strictEqual(p.end('12.5'), 0);
    deepStrictEqual(values, [{}, 12.5]);
    strictEqual(p.finished, true);
    throws(() => new Parser().end('{}[]'), SyntaxError);
}
console.log('PASS: strict and managed document boundaries, tail counts, final chunks');

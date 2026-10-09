import { deepStrictEqual, strictEqual } from 'node:assert';
import { JsonParser, Any, Rest, createDecodedInput } from '../dist/esm/index.js';
// Retaining $ forces the existing general builder for a cross-mode oracle.
class Baseline extends JsonParser {
    constructor(options) {
        super(options);
        this.onValue('$', () => {});
    }
}
import { JsonSubtreeValidator } from '../dist/esm/skip-json.js';
const run = JsonSubtreeValidator.prototype.run;
let skipCalls = 0;
JsonSubtreeValidator.prototype.run = function (...args) {
    skipCalls++;
    return run.apply(this, args);
};
// JSON.parse is only an independent test oracle; the parser never delegates documents to it.
let checks = 0,
    seed = 4564321;
const rand = (n) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
};
const parse = (text, chunks, options) => {
    const p = new JsonParser(options),
        input = createDecodedInput(p),
        got = [];
    p.onValue('$.keep', (v, path) => got.push([v, path]));
    let accepted = true;
    try {
        for (const c of chunks) input.write(c);
        input.end();
    } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        accepted = false;
    }
    return { accepted, got };
};
const fixtures = [
    '[]',
    '{}',
    '[1,0,-0,1.25,2e-3,1E+2,true,false,null]',
    '{"a":{"b":["\\u0041","\\uD800","\\\\","\\\"",[],{}]},"__proto__":1}',
    '["π😀","a\\nb",-1e200,1e-200]',
    '[[[[[[0]]]]]]',
];
for (let i = 0; i < 6000; i++) {
    let part = fixtures[rand(fixtures.length)];
    const alphabet = 'abcxufInNa0129+-.,:[]{}/*\\\" \n\r\t';
    for (let j = 0, n = rand(4); j < n; j++) {
        const at = rand(part.length + 1),
            mode = rand(3),
            ch = alphabet[rand(alphabet.length)];
        part =
            mode === 0
                ? part.slice(0, at) + part.slice(at + 1)
                : mode === 1
                  ? part.slice(0, at) + ch + part.slice(at)
                  : part.slice(0, at) + ch + part.slice(at + 1);
    }
    const text = '{"skip":' + part + ',"keep":"ok"}',
        bytes = new TextEncoder().encode(text),
        cut = rand(bytes.length + 1);
    let wanted,
        valid = true;
    try {
        wanted = JSON.parse(text);
    } catch {
        valid = false;
    }
    for (const chunks of [
        [text],
        [text.slice(0, cut), text.slice(cut)],
        [bytes.subarray(0, cut), bytes.subarray(cut)],
    ]) {
        const result = parse(text, chunks);
        strictEqual(result.accepted, valid, text);
        if (valid) deepStrictEqual(result.got, [[wanted.keep, ['keep']]]);
        checks++;
    }
}
for (const part of fixtures) {
    const text = '{"skip":' + part + ',"keep":"tail"}',
        bytes = new TextEncoder().encode(text);
    for (let cut = 0; cut <= bytes.length; cut++)
        for (const raw of [text, bytes]) {
            const c = Math.min(cut, raw.length);
            const result = parse(text, [raw.slice(0, c), raw.slice(c)]);
            strictEqual(result.accepted, true);
            deepStrictEqual(result.got, [['tail', ['keep']]]);
            checks++;
        }
}
for (const depth of [0, 1, 2, 3, 6, 7, 8, Infinity])
    for (const part of fixtures) {
        const text = '{"skip":' + part + ',"keep":1}';
        const results = [];
        for (const Parser of [Baseline, JsonParser]) {
            const p = new Parser({ maxDepth: depth });
            p.onValue('$.keep', () => {});
            let valid = true;
            try {
                p.write(text);
                p.end();
            } catch {
                valid = false;
            }
            results.push(valid);
        }
        strictEqual(results[0], results[1]);
        checks++;
    }
for (const selector of [['items', Any, 'id'], ['items', Rest], []]) {
    const p = new JsonParser(),
        actual = [];
    p.onValue(selector, (v, path) => actual.push([v, path]));
    p.write('{"skip":[1,{"x":"a"}],"items":[{"id":1},{"id":2}]}');
    p.reset();
    p.write('{"skip":{},"items":[{"id":3}]}');
    p.end();
    const q = new Baseline(),
        expected = [];
    q.onValue(selector, (v, path) => expected.push([v, path]));
    q.write('{"skip":[1,{"x":"a"}],"items":[{"id":1},{"id":2}]}');
    q.reset();
    q.write('{"skip":{},"items":[{"id":3}]}');
    q.end();
    deepStrictEqual(actual, expected);
    checks++;
}
strictEqual(skipCalls > 1000, true);
console.log(JSON.stringify({ passed: true, checks, skipCalls, seed }));

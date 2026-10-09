import { argv } from 'node:process';
const { createParser, createDecodedInput, JsonLinesParser, PrefixedJsonParser } = await import(
    argv[2] ?? new URL('../dist/esm/index.js', import.meta.url).href
);
const createCompactParser = (options) => createParser({ ...options, memoryMode: 'compact' });
class JsonParser {
    constructor(options = {}) {
        return createCompactParser({ ...options, format: 'json' });
    }
}
class Json5Parser {
    constructor(options = {}) {
        return createCompactParser({ ...options, format: 'json5' });
    }
}
import { deepStrictEqual, strictEqual } from 'node:assert';
let checks = 0;
for (const Parser of [JsonParser, Json5Parser])
    for (const bytes of [false, true])
        for (const width of [1, 4, 12, 128, 129, 257]) {
            const value = ('π😀\\\n' + String.fromCharCode(0xd800)).repeat(60).slice(0, width),
                text = JSON.stringify(['x'.repeat(70000), value]),
                raw = bytes ? new TextEncoder().encode(text) : text;
            for (const back of [0, 1, 2, 3, 6, 10]) {
                const p = new Parser(),
                    transport = createDecodedInput(p),
                    saved = [],
                    observer = {
                        text: '',
                        ends: 0,
                        completed: 0,
                        next(v, path) {
                            this.text += v;
                            deepStrictEqual(path, [1]);
                        },
                        end(path) {
                            this.ends++;
                            deepStrictEqual(path, [1]);
                        },
                        complete() {
                            this.completed++;
                        },
                    };
                p.onValue('$[1]', (v, path) => saved.push([v, path]));
                p.onString('$[1]', observer);
                const cut = raw.length - back;
                transport.write(raw.slice(0, cut));
                transport.write(raw.slice(cut));
                p.reset();
                const next = '[0,"next"]';
                transport.write(bytes ? new TextEncoder().encode(next) : next);
                transport.end();
                deepStrictEqual(saved, [
                    [value, [1]],
                    ['next', [1]],
                ]);
                strictEqual(observer.text, value + 'next');
                strictEqual(observer.ends, 2);
                strictEqual(observer.completed, 1);
                checks++;
            }
            const p = new Parser(),
                transport = createDecodedInput(p),
                state = {
                    failed: false,
                    next() {},
                    error(e) {
                        this.failed = e instanceof SyntaxError;
                    },
                };
            p.onString('$[1]', state);
            try {
                transport.write(bytes ? new TextEncoder().encode('[0,"') : '[0,"');
                transport.end();
            } catch (e) {
                strictEqual(e instanceof SyntaxError, true);
            }
            strictEqual(state.failed, true);
            checks++;
        }
// Also exercise promise consumers and the parser's own Web endpoints.
for (const format of ['json', 'json5']) {
    const parser = createCompactParser({ format, collectJson: true }),
        result = parser.getValue('$.value');
    strictEqual(parser.writable, parser.writable);
    const reader = parser.stringStream('$.value').getReader(),
        pending = reader.read();
    const writer = parser.writable.getWriter();
    const text = JSON.stringify({ skip: 'x'.repeat(70000), value: 'π😀' });
    await writer.write(text);
    await writer.close();
    strictEqual(await result, 'π😀');
    deepStrictEqual(await pending, { done: false, value: 'π😀' });
    deepStrictEqual(await reader.read(), { done: true, value: undefined });
    strictEqual(parser.json, text);
    checks++;
}
// Exercise every UTF-16 code unit through both the one-unit and joined copy paths.
for (const Parser of [JsonParser, Json5Parser]) {
    const expected = Array.from(
        { length: 65536 },
        (_, code) => String.fromCharCode(code) + 'abcdefghijklmnop',
    );
    const parser = new Parser({}),
        values = [];
    parser.onValue('$[*]', (value) => values.push(value));
    const text = JSON.stringify(expected);
    for (let at = 0; at < text.length; at += 65536) parser.write(text.slice(at, at + 65536));
    parser.end();
    deepStrictEqual(values, expected);
    checks++;
}
// Record wrappers preserve compact policy, paths and record indexes across reset.
for (const format of ['json', 'json5'])
    for (const bytes of [false, true])
        for (const prefix of [false, true]) {
            const options = { format, memoryMode: 'compact' };
            const p = prefix ? new PrefixedJsonParser('@', options) : new JsonLinesParser(options);
            const values = [],
                fragments = [];
            p.onValue('$.label', (v, path, i) => values.push([v, path, i]));
            p.onString('$.label', (v, path, i) => fragments.push([v, path, i]));
            const doc = JSON.stringify({ skip: 'x'.repeat(70000), label: 'π😀\ud800' });
            const text = prefix ? '@' + doc + 'junk@' + doc : doc + '\n' + doc + '\n';
            p.write(bytes ? new TextEncoder().encode(text) : text);
            p.end();
            const expected = [
                ['π😀\ud800', ['label'], 0],
                ['π😀\ud800', ['label'], 1],
            ];
            deepStrictEqual(values, expected);
            deepStrictEqual(fragments, expected);
            checks++;
        }
console.log(
    JSON.stringify({
        passed: true,
        checks,
        scope: 'compact parser and JSONL/prefix: JSON/JSON5, text/bytes, lone surrogates, threshold 128/129, large-to-small cuts, reset, owned paths, observer this/end/error/complete',
    }),
);

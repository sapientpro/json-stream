import {argv} from 'node:process';
const {createCopyingParser} = await import(argv[2] ?? new URL('../../dist/esm/v3/copying.js', import.meta.url).href);
class JsonParser {
    constructor(options = {}) { return createCopyingParser({ ...options, format: 'json' }); }
}
class Json5Parser {
    constructor(options = {}) { return createCopyingParser({ ...options, format: 'json5' }); }
}
import { deepStrictEqual, strictEqual } from 'node:assert';
let checks = 0;
for (const Parser of [JsonParser, Json5Parser])
    for (const bytes of [false, true])
        for (const width of [1, 4, 12, 128, 129, 257]) {
            const value = ('π😀\\\n' + String.fromCharCode(0xd800)).repeat(60).slice(0, width), text = JSON.stringify(['x'.repeat(70000), value]), raw = bytes ? new TextEncoder().encode(text) : text;
            for (const back of [0, 1, 2, 3, 6, 10]) {
                const p = new Parser(), saved = [], observer = { text: '', ends: 0, completed: 0, next(v, path) { this.text += v; deepStrictEqual(path, [1]); }, end(path) { this.ends++; deepStrictEqual(path, [1]); }, complete() { this.completed++; } };
                p.onValue('$[1]', (v, path) => saved.push([v, path]));
                p.onString('$[1]', observer);
                const cut = raw.length - back;
                p.write(raw.slice(0, cut));
                p.write(raw.slice(cut));
                p.reset();
                const next = '[0,"next"]';
                p.write(bytes ? new TextEncoder().encode(next) : next);
                p.end();
                deepStrictEqual(saved, [[value, [1]], ['next', [1]]]);
                strictEqual(observer.text, value + 'next');
                strictEqual(observer.ends, 2);
                strictEqual(observer.completed, 1);
                checks++;
            }
            const p = new Parser(), state = { failed: false, next() { }, error(e) { this.failed = e instanceof SyntaxError; } };
            p.onString('$[1]', state);
            try {
                p.write(bytes ? new TextEncoder().encode('[0,"') : '[0,"');
                p.end();
            }
            catch (e) {
                strictEqual(e instanceof SyntaxError, true);
            }
            strictEqual(state.failed, true);
            checks++;
        }
// Also exercise promise consumers and the facade's own Web endpoints.
for (const format of ['json', 'json5']) {
    const parser = createCopyingParser({ format, collectJson: true }), result = parser.getValue('$.value');
    strictEqual(parser.writable, parser.writable);
    const reader = parser.stringStream('$.value').getReader(), pending = reader.read();
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
console.log(JSON.stringify({ passed: true, checks, scope: 'copying parser: JSON/JSON5, text/bytes, lone surrogates, threshold 128/129, large-to-small cuts, reset, owned paths, observer this/end/error/complete' }));

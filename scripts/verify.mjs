const capturedValues = new WeakMap();
const captureRoot = (parser) => {
    parser.onValue('$', (value) => capturedValues.set(parser, value));
    return parser;
};
const capturedRoot = (parser) => (parser.rootReady ? capturedValues.get(parser) : undefined);
// Differential tests use JSON.parse/JSON5.parse as independent oracles only.
import { deepStrictEqual, strictEqual } from 'node:assert';
import JSON5 from 'json5';
import { JsonParser, Json5Parser, Any, createDecodedInput } from '../dist/esm/index.js';
let seed = 987654321,
    checks = 0;
const random = (n) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
};
const alphabet = 'abcxufInNa0129+-.,:[]{}/*\\"\' \n\r\t';
for (const [Parser, oracle, fixtures] of [
    [
        JsonParser,
        JSON.parse,
        [
            '{"a":[1,0.5,-10],"b":"a\\u0041\\n"}',
            '[true,false,null,1e20]',
            '{"0":"x","__proto__":1}',
            '"\\uD83D\\uDE00"',
        ],
    ],
    [
        Json5Parser,
        JSON5.parse,
        [
            "{a:[1,.5,-0x10,],b:'a\\x41\\0b',}",
            '/*start*/[true,false,null,Infinity,NaN]//end',
            "{'0':'x',a\\u0062:1,}",
            "{a:'a\\\r\nb',b:1.e+2}",
            "[{'__proto__':1},'\\uD83D\\uDE00']",
        ],
    ],
]) {
    for (let i = 0; i < 5000; i++) {
        let doc = fixtures[random(fixtures.length)];
        for (let j = 0, n = 1 + random(3); j < n; j++) {
            const at = random(doc.length + 1),
                mode = random(3),
                ch = alphabet[random(alphabet.length)];
            doc =
                mode === 0
                    ? doc.slice(0, at) + doc.slice(at + 1)
                    : mode === 1
                      ? doc.slice(0, at) + ch + doc.slice(at)
                      : doc.slice(0, at) + ch + doc.slice(at + 1);
        }
        let wanted,
            valid = true;
        try {
            wanted = oracle(doc);
        } catch {
            valid = false;
        }
        const bytes = new TextEncoder().encode(doc),
            cut = random(bytes.length + 1);
        for (const chunks of [[doc], [bytes.subarray(0, cut), bytes.subarray(cut)]]) {
            let actual,
                accepted = true;
            try {
                const p = captureRoot(new Parser());
                const input = createDecodedInput(p);
                for (const c of chunks) input.write(c);
                input.end();
                actual = capturedRoot(p);
            } catch {
                accepted = false;
            }
            try {
                strictEqual(accepted, valid);
                if (valid) deepStrictEqual(actual, wanted);
            } catch (e) {
                console.error({ format: Parser.name, doc, accepted, valid, cut });
                throw e;
            }
            ++checks;
        }
    }
    // Differential selected-value retention across generated objects, every chunk size.
    for (let i = 0; i < 100; i++) {
        const root = {
            skip: { deep: [{ unused: '😀'.repeat(4) }] },
            items: Array.from({ length: 1 + random(8) }, (_, id) => ({
                id,
                text: '€😀' + random(1000),
                n: random(10) / 7,
            })),
        };
        const text = Parser === JsonParser ? JSON.stringify(root) : JSON5.stringify(root),
            bytes = new TextEncoder().encode(text);
        for (const size of [1, 2, 3, 7, 64, 1024]) {
            // Preserve closed sibling containers and prior roots across depth/type reuse and reset.
            const retained = captureRoot(new Parser()),
                retainedInput = createDecodedInput(retained);
            for (let at = 0; at < bytes.length; at += size)
                retainedInput.write(bytes.subarray(at, at + size));
            const priorRoot = capturedRoot(retained);
            deepStrictEqual(priorRoot, root);
            retained.reset();
            const next = {
                mixed: [[{ id: i }], { nested: [{}, [], null] }, [false, { last: i }]],
                empty: {},
            };
            const nextBytes = new TextEncoder().encode(JSON.stringify(next));
            for (let at = 0; at < nextBytes.length; at += size)
                retainedInput.write(nextBytes.subarray(at, at + size));
            retainedInput.end();
            deepStrictEqual(capturedRoot(retained), next);
            deepStrictEqual(priorRoot, root);
            ++checks;
            const p = new Parser({}),
                values = [],
                paths = [],
                fragments = [],
                ends = [];
            p.onValue(['items', Any], (v, path) => {
                values.push(v);
                paths.push(path);
            });
            p.onString(['items', Any, 'text'], {
                next: (v, path) => fragments.push([v, path]),
                end: (path) => ends.push(path),
            });
            const input = createDecodedInput(p);
            for (let at = 0; at < bytes.length; at += size)
                input.write(bytes.subarray(at, at + size));
            input.end();
            deepStrictEqual(values, root.items);
            deepStrictEqual(
                paths,
                root.items.map((_, id) => ['items', id]),
            );
            for (let id = 0; id < root.items.length; id++)
                strictEqual(
                    fragments
                        .filter(([, path]) => path[1] === id)
                        .map(([v]) => v)
                        .join(''),
                    root.items[id].text,
                );
            deepStrictEqual(
                ends,
                root.items.map((_, id) => ['items', id, 'text']),
            );
            strictEqual(capturedRoot(p), undefined);
            ++checks;
        }
    }
}
console.log(
    JSON.stringify({
        passed: true,
        checks,
        seed: 987654321,
        scope: 'JSON/JSON5 differential acceptance and root, selective values/paths/string fragments; 5000 mutations and 100 generated documents per format',
    }),
);

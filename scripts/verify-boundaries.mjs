import { deepStrictEqual, strictEqual, throws } from 'node:assert';
const { JsonParser, Json5Parser } = await import(
    process.argv[2] ?? new URL('../dist/esm/index.js', import.meta.url).href
);
let seed = 6729481,
    checks = 0;
const random = (n) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
};
for (const Parser of [JsonParser, Json5Parser])
    for (const memoryMode of ['fast', 'compact']) {
        const fixtures = Array.from({ length: 200 }, (_, id) => {
            const value =
                id % 5 === 0
                    ? id / 7
                    : id % 5 === 1
                      ? 'π😀\\\n' + id
                      : id % 5 === 2
                        ? [null, true, false, id]
                        : { id, text: 'π😀', nested: { a: [{}, [], id / 7] } };
            return [JSON.stringify(value), value];
        });
        if (Parser === Json5Parser)
            fixtures.push(
                ["/*lead*/{key:'π😀',n:0x10,}", { key: 'π😀', n: 16 }],
                ['+.5', 0.5],
                ['1.', 1],
                ['Infinity', Infinity],
                ['NaN', NaN],
            );
        for (const [body, value] of fixtures)
            for (let trial = 0; trial < 12; trial++) {
                const suffix = ' NEXT😀',
                    text = body + suffix,
                    positions = [random(text.length + 1), random(text.length + 1)].sort(
                        (a, b) => a - b,
                    );
                const chunks = [
                    text.slice(0, positions[0]),
                    text.slice(positions[0], positions[1]),
                    text.slice(positions[1]),
                ];
                const p = new Parser({ memoryMode, strictEnd: false, collectJson: true });
                let found,
                    count = 0;
                p.onValue('$', (v) => {
                    found = v;
                    count++;
                });
                let recovered;
                for (let i = 0; i < chunks.length; i++) {
                    const unread = p.write(chunks[i]);
                    if (p.rootReady) {
                        recovered =
                            chunks[i].slice(chunks[i].length - unread) +
                            chunks.slice(i + 1).join('');
                        break;
                    }
                    strictEqual(unread, 0);
                }
                strictEqual(recovered, suffix);
                deepStrictEqual(found, value);
                strictEqual(count, 1);
                strictEqual(p.json, body);
                strictEqual(p.finished, false);
                throws(() => p.write(''), /reset/);
                strictEqual(p.end(), 0);
                strictEqual(p.finished, true);
                checks++;
            }
        const invalid =
            Parser === JsonParser
                ? ['{', '[1,]', '{"a":}', '"\\u12', '"\\q"', '1e+', '[true false]']
                : ['{', '[1,,2]', '{a:}', '"\\u12', '0x', '1e+', '[true false]'];
        for (const body of invalid)
            for (let cut = 0; cut <= body.length; cut++) {
                const p = new Parser({ memoryMode, strictEnd: false });
                throws(() => {
                    p.write(body.slice(0, cut));
                    p.end(body.slice(cut));
                }, SyntaxError);
                checks++;
            }
    }
console.log(
    JSON.stringify({
        passed: true,
        checks,
        seed: 6729481,
        scope: 'fast/compact text-only managed tails, chunk cuts, collection, root/EOF lifecycle, JSON5 tokens and malformed documents',
    }),
);

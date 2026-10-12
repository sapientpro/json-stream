import { deepStrictEqual, strictEqual } from 'node:assert';
const { compileSelectors, JsonParser, Json5Parser, Rest, Any } = await import(
    process.argv[2] ?? new URL('../dist/esm/index.js', import.meta.url).href
);
const definitions = [
    [Rest],
    [Rest, Rest, 'id'],
    [Rest, 'items', Rest, 'id'],
    [Rest, 'id'],
    [Rest, 'items', Any, 'id'],
    [Rest, Any],
    [0],
    ['0'],
    { path: [Rest, 'text'], kind: 'string' },
    '$.items[*].id',
];
const plan = compileSelectors(definitions);
let checks = 0,
    seed = 918231;
const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
};
function value(depth = 0) {
    if (depth > 4) return random(100);
    switch (random(6)) {
        case 0:
            return Array.from({ length: random(4) }, () => value(depth + 1));
        case 1:
        case 2: {
            const obj = {};
            for (let i = 0, n = random(5); i < n; ++i)
                obj[['id', 'items', 'text', '0', 'other'][random(5)]] = value(depth + 1);
            return obj;
        }
        case 3:
            return '😀text\\\n\tПривіт';
        case 4:
            return null;
        default:
            return random(1000) / 7;
    }
}
function compare(Parser, text, width, memoryMode, cancel = false, reset = false) {
    const run = (planned) => {
        const events = [],
            parser = new Parser({ memoryMode, maxDepth: 8 });
        const callbacks = definitions.map((_, i) => ({
            next(v, path) {
                events.push(['value', i, v, path]);
                if (cancel) subscriptions[i].unsubscribe();
            },
            end: (path) => events.push(['end', i, path]),
            error: (error) => events.push(['error', i, error.message]),
            complete: () => events.push(['complete', i]),
        }));
        const subscriptions = planned
            ? plan.bind(parser, callbacks)
            : definitions.map((definition, i) => {
                  if (typeof definition === 'string' || Array.isArray(definition))
                      return parser.onValue(definition, callbacks[i]);
                  return parser.onString(definition.path, callbacks[i]);
              });
        if (cancel) subscriptions[0].unsubscribe();
        try {
            for (let i = 0; i < text.length; i += width) parser.write(text.slice(i, i + width));
            if (reset) {
                parser.reset();
                for (let i = 0; i < text.length; i += width) parser.write(text.slice(i, i + width));
            }
            parser.end();
        } catch (error) {
            events.push(['throw', error.message]);
        }
        return events;
    };
    deepStrictEqual(
        run(true),
        run(false),
        JSON.stringify({ parser: Parser.name, text, width, memoryMode, cancel, reset }),
    );
    ++checks;
}
for (const Parser of [JsonParser, Json5Parser]) {
    for (const memoryMode of ['fast', 'compact']) {
        for (let i = 0; i < 150; ++i) {
            const text = JSON.stringify(value());
            for (const width of [1, 7, 32, text.length + 1])
                compare(Parser, text, width, memoryMode, i % 3 === 0, i % 7 === 0);
        }
        const fixtures = [
            '',
            '{"id":1,}',
            '{"id":1',
            '{"text":"\\uZZZZ"}',
            '{"id":NaN}',
            '{"id":1} trailing',
            '{"id":01}',
            '['.repeat(9) + '1' + ']'.repeat(9),
            '{"id":1,"items":[{"id":2,"text":"😀\\u0061"}],"0":3}',
            "{id:1,items:[{id:2,text:'Привіт\\\nсвіте'}],/*hi*/other:Infinity}",
            '{"id":1,//line\u2028"text":"ok"}',
        ];
        for (const text of fixtures)
            for (let cut = 1; cut <= Math.max(1, text.length); ++cut)
                compare(Parser, text, cut, memoryMode);
    }
    const a = new Parser(),
        b = new Parser(),
        left = [],
        right = [];
    const ids = compileSelectors(['$..id']);
    ids.bind(a, [(v) => left.push(v)]);
    ids.bind(b, [(v) => right.push(v)]);
    a.write('{"id":1,');
    b.end('{"id":2}');
    a.end('"items":[{"id":3}]}');
    deepStrictEqual(left, [1, 3]);
    deepStrictEqual(right, [2]);
    strictEqual(a.closed, true);
    ++checks;
}
console.log('Compiled selector plan differential checks: ' + checks);

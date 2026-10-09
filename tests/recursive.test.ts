import { describe, expect, test } from '@jest/globals';
import {
    Any,
    Rest,
    JsonParser,
    Json5Parser,
    JsonLinesParser,
    PrefixedJsonParser,
    compileJsonPath,
} from '../src/index';
import type { Path, PathSegment } from '../src/types';

// Independent path oracle: Rest skips zero or more levels before a suffix;
// a terminal Rest selects at least one descendant.
function matches(selector: Path, path: readonly PathSegment[], s = 0, p = 0): boolean {
    if (s === selector.length) return p === path.length;
    if (selector[s] === Rest) {
        if (s + 1 === selector.length) return p < path.length;
        for (let end = p; end <= path.length; end++)
            if (matches(selector, path, s + 1, end)) return true;
        return false;
    }
    return (
        p < path.length &&
        (selector[s] === Any || selector[s] === path[p]) &&
        matches(selector, path, s + 1, p + 1)
    );
}
function completed(value: any, path: PathSegment[] = []): [any, PathSegment[]][] {
    const out: [any, PathSegment[]][] = [];
    if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            const segment = Array.isArray(value) ? Number(key) : key;
            out.push(...completed(value[key], [...path, segment]));
        }
    }
    out.push([value, path]);
    return out;
}

test.each([
    ['$..id', [Rest, 'id']],
    ['$..*', [Rest]],
    ['$..[*]', [Rest]],
    ['$.items..*', ['items', Rest]],
    ['$..[0]', [Rest, 0]],
    ['$..["0"]', [Rest, '0']],
    ['$..["a.b"]', [Rest, 'a.b']],
    ['$..*.id', [Rest, Any, 'id']],
    ['$..[*].id', [Rest, Any, 'id']],
    ['$..a..id', [Rest, 'a', Rest, 'id']],
] as const)('compiles recursive query %s', (query, path) => {
    const result = compileJsonPath(query);
    expect(result).toEqual(path);
    expect(Object.isFrozen(result)).toBe(true);
});
test.each([
    '$..',
    '$...',
    '$...id',
    '$.. id',
    '$..[0:2]',
    '$..[?(@.id)]',
    '$..[-1]',
    '$..[0,1]',
    '$..[]',
])('rejects invalid recursion %s', (query) => {
    expect(() => compileJsonPath(query)).toThrow(SyntaxError);
});

describe.each([JsonParser, Json5Parser])('recursive contexts', (Parser) => {
    const raw =
        '{"id":0,"a":{"id":{"id":1},"a":{"id":2},"items":[{"id":3},{"0":4,"id":5}]},"items":[{"id":6}],"__proto__":{"id":7},"0":{"id":8}}';
    const source = JSON.parse(raw);
    const text = JSON.stringify(source);
    const paths: Path[] = [
        [Rest],
        [Rest, 'id'],
        ['a', Rest, 'id'],
        [Rest, 'a', Rest, 'id'],
        [Rest, Any, 'id'],
        [Rest, 0],
        [Rest, '0'],
        [Rest, Rest, 'id'],
        [Rest, 'id', Rest],
        [Rest, 'id', Rest, 'id'],
        [Rest, Any, Rest, Any],
        [Rest, 'missing'],
        ['__proto__', Rest],
        ['items', Any, 'id'],
    ];
    test('suffixes match an independent oracle across every input split', () => {
        for (let cut = 0; cut <= text.length; cut++) {
            const parser = new Parser();
            const found = paths.map(() => [] as [any, readonly PathSegment[]][]);
            paths.forEach((path, i) => {
                parser.onValue(path, (value, concrete) => found[i]!.push([value, concrete]));
            });
            // A separate registration at the same leaf should still receive its own callback.
            const duplicate: unknown[] = [];
            parser.onValue([Rest, 'id'], (value, concrete) => duplicate.push([value, concrete]));
            parser.write(text.slice(0, cut));
            parser.write(text.slice(cut));
            parser.end();
            paths.forEach((path, i) => {
                expect(found[i]).toEqual(
                    completed(source).filter(([, concrete]) => matches(path, concrete)),
                );
            });
            expect(duplicate).toEqual(found[1]);
        }
    });
    test('isolated recursive selectors retain only requested values in both memory modes', () => {
        for (const selector of paths)
            for (const memoryMode of ['fast', 'compact'] as const)
                for (const size of [1, 7, 65536]) {
                    const parser = new Parser({ memoryMode });
                    const found: unknown[] = [];
                    parser.onValue(selector, (value, path) => found.push([value, path]));
                    for (let start = 0; start < text.length; start += size)
                        parser.write(text.slice(start, start + size));
                    parser.end();
                    expect(found).toEqual(
                        completed(source).filter(([, path]) => matches(selector, path)),
                    );
                }
    });
    test('recursive strings deduplicate converging routes without a value consumer', () => {
        const parser = new Parser();
        const found: unknown[] = [];
        parser.onString([Rest, Any, Rest, 'text'], (part, path) => found.push([part, path]));
        parser.end('{"a":{"b":{"text":"once"}},"text":"excluded"}');
        expect(found).toEqual([['once', ['a', 'b', 'text']]]);
    });
    test('generated trees and overlapping recursive suffixes match the path oracle', () => {
        let seed = 137;
        const random = (n: number) => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed % n;
        };
        const tree = (depth: number): any => {
            if (!depth || random(4) === 0) return random(10);
            if (random(2)) return [tree(depth - 1), tree(depth - 1)];
            return { a: tree(depth - 1), id: tree(depth - 1), '0': tree(depth - 1) };
        };
        const alphabet = [Rest, Any, 'a', 'id', 0, '0'] as const;
        for (let trial = 0; trial < 20; trial++) {
            const value = tree(4);
            const text = JSON.stringify(value);
            const all = completed(value);
            const parser = new Parser();
            const selectors = Array.from({ length: 40 }, () =>
                Array.from({ length: 1 + random(5) }, () => alphabet[random(alphabet.length)]!),
            );
            const found = selectors.map(() => [] as unknown[]);
            selectors.forEach((path, i) => {
                parser.onValue(path, (value, concrete) => found[i]!.push([value, concrete]));
            });
            for (let start = 0; start < text.length; start += 13)
                parser.write(text.slice(start, start + 13));
            parser.end();
            selectors.forEach((path, i) => {
                expect(found[i]).toEqual(all.filter(([, concrete]) => matches(path, concrete)));
            });
        }
    });
    test('recursive string fragments, values, unsubscribe and reset', () => {
        const text = '{"text":"a\\uD83D\\uDE00b","a":{"text":"c\\nd"},"other":"ignored"}';
        const parser = new Parser();
        const fragments = new Map<string, string>();
        const values: unknown[] = [];
        const once: unknown[] = [];
        parser.onString('$..text', (part, path) => {
            const key = JSON.stringify(path);
            fragments.set(key, (fragments.get(key) ?? '') + part);
        });
        parser.onValue('$..text', (value, path) => values.push([value, path]));
        const sub = parser.onValue([Rest, 'text'], (value) => {
            once.push(value);
            sub.unsubscribe();
        });
        for (const char of text) parser.write(char);
        parser.reset();
        for (const char of text) parser.write(char);
        parser.end();
        expect([...fragments]).toEqual([
            ['["text"]', 'a😀ba😀b'],
            ['["a","text"]', 'c\ndc\nd'],
        ]);
        expect(values).toEqual([
            ['a😀b', ['text']],
            ['c\nd', ['a', 'text']],
            ['a😀b', ['text']],
            ['c\nd', ['a', 'text']],
        ]);
        expect(once).toEqual(['a😀b']);
    });
    test('terminal recursion excludes its prefix and primitive roots', () => {
        for (const input of ['1', '"text"', 'null', '[]', '{}']) {
            const parser = new Parser();
            const values: unknown[] = [];
            parser.onValue('$..*', (value) => values.push(value));
            parser.write(input);
            parser.end();
            expect(values).toEqual([]);
        }
    });
    test('still validates unselected recursive branches', () => {
        const parser = new Parser();
        parser.onValue('$..missing', () => {});
        expect(() => parser.end('{"a":{"bad":"\\u00GG"}}')).toThrow(SyntaxError);
    });
});

test.each([JsonLinesParser, PrefixedJsonParser])(
    '%s preserves recursion across managed records',
    (Manager) => {
        const parser =
            Manager === JsonLinesParser ? new JsonLinesParser() : new PrefixedJsonParser('@');
        const values: unknown[] = [];
        parser.onValue('$..id', (value, path, index) => values.push([value, path, index]));
        parser.write(
            Manager === JsonLinesParser ? '{"id":1}\n{"a":{"id":2}}' : '@{"id":1}@{"a":{"id":2}}',
        );
        parser.end();
        expect(values).toEqual([
            [1, ['id'], 0],
            [2, ['a', 'id'], 1],
        ]);
    },
);

test('JSON5 native syntax uses the same recursive contexts', () => {
    const parser = new Json5Parser();
    const found: unknown[] = [];
    parser.onValue('$..id', (value, path) => found.push([value, path]));
    parser.end('{id:0x10, nested: /*comment*/ [{id:+.5,}, {id:-Infinity}],}');
    expect(found).toEqual([
        [16, ['id']],
        [0.5, ['nested', 0, 'id']],
        [-Infinity, ['nested', 1, 'id']],
    ]);
});

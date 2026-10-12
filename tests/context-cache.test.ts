import { expect, test } from '@jest/globals';
import {
    JsonParser,
    Json5Parser,
    JsonLinesParser,
    PrefixedJsonParser,
    Rest,
    compileSelectors,
} from '../src/index';
import type { Context } from '../src/selectors';

function graph(parser: unknown): { states: number; slots: number } {
    const root = (parser as { _rootContext: Context })._rootContext;
    const seen = new Set<Context>(),
        pending = [root];
    let slots = 0;
    while (pending.length) {
        const context = pending.pop()!;
        if (seen.has(context)) continue;
        seen.add(context);
        slots += Object.keys(context.edges).length + Object.keys(context.indexes).length + 1;
        for (const next of [
            ...Object.values(context.edges),
            ...Object.values(context.indexes),
            ...(context.cache?.states ?? []),
            context.fallback,
        ])
            if (next) pending.push(next);
    }
    return { states: seen.size, slots };
}
function documents(count: number): string[] {
    let seed = 3;
    return Array.from({ length: count }, () => {
        let value = '1';
        for (let depth = 0; depth < 18; depth++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            value = `{"${seed & 0x80000000 ? 'id' : 'x'}":${value}}`;
        }
        return value;
    });
}
for (const Parser of [JsonParser, Json5Parser]) {
    test(`${Parser.name}: varying recursive paths share states within and across documents`, () => {
        const parser = new Parser();
        let count = 0;
        parser.onValue('$..id', () => count++);
        const docs = documents(2000);
        parser.write('[');
        docs.forEach((text, i) => {
            parser.write((i ? ',' : '') + text);
        });
        parser.write(']');
        const before = graph(parser);
        expect(before.states).toBeLessThan(20);
        const expected = docs.reduce((n, text) => n + (text.match(/"id"/g)?.length ?? 0), 0);
        expect(count).toBe(expected);
        parser.reset();
        parser.write('[' + [...docs].reverse().join(',') + ']');
        expect(graph(parser)).toEqual(before);
        expect(count).toBe(2 * expected);
        parser.end();
    });
    test(`${Parser.name}: terminal Rest reuses states without changing descendant order`, () => {
        const parser = new Parser();
        const paths: unknown[] = [];
        parser.onValue([Rest], (_v, path) => paths.push(path));
        parser.write('{"a":{"b":{"c":1}},"d":2}');
        expect(paths).toEqual([['a', 'b', 'c'], ['a', 'b'], ['a'], ['d']]);
        expect(graph(parser).states).toBeLessThan(5);
        parser.end();
    });
}

test('cache budget stops retaining new transitions while all selectors still dispatch', () => {
    const parser = new JsonParser(),
        count = 400;
    const values: unknown[] = [];
    for (let i = 0; i < count; i++)
        parser.onValue([Rest, 'key' + i], (value) => values.push(value));
    const text = JSON.stringify(
        Object.fromEntries(Array.from({ length: count }, (_, i) => ['key' + i, i])),
    );
    parser.write(text);
    expect(values).toEqual(Array.from({ length: count }, (_, i) => i));
    const bounded = graph(parser);
    expect(bounded.states).toBeLessThanOrEqual(4097);
    expect(bounded.slots).toBeLessThanOrEqual(65537);
    parser.reset();
    parser.write(text);
    expect(values).toHaveLength(2 * count);
    expect(graph(parser)).toEqual(bounded);
    parser.end();
});

test('large plans falling back to lazy contexts retain the cache budget', () => {
    const selectors = Array.from({ length: 300 }, (_, i) => [Rest, 'key' + i] as const);
    const plan = compileSelectors(selectors),
        parser = new JsonParser();
    let count = 0;
    plan.bind(
        parser,
        selectors.map(() => () => count++),
    );
    parser.write(JSON.stringify(Object.fromEntries(selectors.map((_, i) => ['key' + i, i]))));
    expect(count).toBe(selectors.length);
    expect((parser as unknown as { _rootContext: Context })._rootContext.cache).toBeDefined();
    expect(graph(parser).slots).toBeLessThanOrEqual(65537);
    parser.end();
});

test.each(['lines', 'prefix'] as const)(
    'long-lived %s managers do not retain a context per path history',
    (kind) => {
        const manager = kind === 'lines' ? new JsonLinesParser() : new PrefixedJsonParser('data:');
        let count = 0;
        manager.onValue('$..id', () => count++);
        const docs = documents(2000);
        for (const text of docs) manager.write(kind === 'lines' ? text + '\n' : 'data:' + text);
        const parser = (manager as unknown as { parser: unknown }).parser;
        expect(graph(parser).states).toBeLessThan(20);
        expect(count).toBe(docs.reduce((n, text) => n + (text.match(/"id"/g)?.length ?? 0), 0));
        manager.end();
    },
);

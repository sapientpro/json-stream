import { describe, expect, test } from '@jest/globals';
import { finished } from 'node:stream/promises';
import {
    JsonParser,
    Json5Parser,
    JsonLinesParser,
    PrefixedJsonParser,
    Any,
    Rest,
} from '../src/index';
import { JsonStream } from '../src/node';

describe.each([JsonParser, Json5Parser])('%s subscription-driven values', (Parser) => {
    test('default parser validates without a root getter or implicit result', () => {
        const parser = new Parser();
        parser.write('{"ignored":[{"text":"large"}]}');
        parser.end();
        expect(parser.rootReady).toBe(true);
        expect(parser.finished).toBe(true);
        expect('root' in parser).toBe(false);
        expect('onValueJsonPath' in parser).toBe(false);
        expect(() => new Parser({ retainRoot: true } as any)).toThrow(TypeError);
    });
    test('getValue defaults to the complete root and preserves special object keys', async () => {
        const parser = new Parser();
        const value = parser.getValue();
        parser.write('{"__proto__":{"x":1},"items":[{"id":2}]}');
        parser.end();
        expect(await value).toEqual(JSON.parse('{"__proto__":{"x":1},"items":[{"id":2}]}'));
    });
    test.each(['[1 2]', '{"s":"\\u00GG"}', '{"ignored":[true false]}'])(
        'still validates unrequested input %j',
        (input) => {
            const parser = new Parser();
            expect(() => {
                parser.write(input);
                parser.end();
            }).toThrow(SyntaxError);
        },
    );
    test('JSONPath strings and typed arrays share selectors and concrete owned paths', () => {
        const parser = new Parser();
        const found: unknown[] = [];
        for (const path of ['$.items[*].id', ['items', Any, 'id']] as const)
            parser.onValue(path, (value, path) => found.push([value, path]));
        parser.onValue('$["a.b"]["0"]', (value, path) => found.push([value, path]));
        parser.write('{"items":[{"id":2}],"a.b":{"0":3}}');
        parser.end();
        expect(found).toEqual([
            [2, ['items', 0, 'id']],
            [2, ['items', 0, 'id']],
            [3, ['a.b', '0']],
        ]);
    });
    test.each(['items.id', '', '$..', '$[0:2]', '$[?(@.id)]'])(
        'rejects ambiguous or unsupported string %j',
        (path) => {
            const parser = new Parser();
            expect(() => parser.onValue(path, () => {})).toThrow(SyntaxError);
            expect(() => parser.onString(path, () => {})).toThrow(SyntaxError);
            expect(() => parser.stringStream(path)).toThrow(SyntaxError);
        },
    );
    test('invalid getValue query rejects a promise', async () => {
        await expect(new Parser().getValue('items.id')).rejects.toThrow(SyntaxError);
    });
    test('root fragments and root value are separate subscriptions', () => {
        const parser = new Parser();
        const parts: string[] = [];
        const roots: unknown[] = [];
        parser.onString('$', (part) => parts.push(part));
        parser.onValue('$', (value) => roots.push(value));
        parser.write('"first');
        expect(parts).toEqual(['first']);
        expect(roots).toEqual([]);
        parser.write(' second"');
        parser.end();
        expect(parts.join('')).toBe('first second');
        expect(roots).toEqual(['first second']);
        const fragmentsOnly = new Parser();
        let text = '';
        const sub = fragmentsOnly.onString('$', (part) => {
            text += part;
            sub.unsubscribe();
        });
        fragmentsOnly.write('"one');
        fragmentsOnly.write('two"');
        fragmentsOnly.end();
        expect(text).toBe('one');
        expect('root' in fragmentsOnly).toBe(false);
    });
    test('persistent root subscription survives reset while first-value promise unsubscribes', async () => {
        const parser = new Parser();
        const values: unknown[] = [];
        const first = parser.getValue();
        parser.onValue('$', (value) => values.push(value));
        parser.write('1');
        parser.reset();
        parser.write('{"second":[2]}');
        parser.end();
        expect(await first).toBe(1);
        expect(values).toEqual([1, { second: [2] }]);
    });
    test('array Rest retains its explicit descendant semantics', () => {
        const parser = new Parser();
        const values: unknown[] = [];
        parser.onValue(['a', Rest], (value, path) => values.push([value, path]));
        parser.write('{"a":{"b":1}}');
        parser.end();
        expect(values).toEqual([[1, ['a', 'b']]]);
    });
});

for (const Manager of [JsonLinesParser, PrefixedJsonParser])
    test(Manager.name + ' uses the same JSONPath API across records', async () => {
        const parser =
            Manager === JsonLinesParser ? new JsonLinesParser() : new PrefixedJsonParser('@');
        const first = parser.getValue('$.id');
        const found: unknown[] = [];
        parser.onString('$.text', (part, path, index) => found.push([part, path, index]));
        expect(() => parser.onValue('id', () => {})).toThrow(SyntaxError);
        parser.write(
            Manager === JsonLinesParser
                ? '{"id":1,"text":"a"}\n{"id":2,"text":"b"}'
                : '@{"id":1,"text":"a"}@{"id":2,"text":"b"}',
        );
        parser.end();
        expect(await first).toBe(1);
        expect(found).toEqual([
            ['a', ['text'], 0],
            ['b', ['text'], 1],
        ]);
    });

test('Node value listeners subscribe to the root and may be removed before input', async () => {
    const stream = new JsonStream();
    const values: unknown[] = [];
    const unused = () => {
        throw Error('removed listener');
    };
    stream.on('value', unused);
    stream.removeListener('value', unused);
    stream.on('value', (value) => {
        expect(stream.rootReady).toBe(true);
        values.push(value);
    });
    const field = stream.getValue('$.id');
    stream.end('{"id":42}');
    await finished(stream);
    expect(await field).toBe(42);
    expect(values).toEqual([{ id: 42 }]);
    expect('root' in stream).toBe(false);
});

test('Node root event listeners follow the same registration boundary', async () => {
    const stream = new JsonStream();
    stream.on('value', () => {});
    stream.write('{"id":');
    expect(() => stream.on('value', () => {})).toThrow('before');
    stream.end('42}');
    await finished(stream);
});

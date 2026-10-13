import { expect, test } from '@jest/globals';
import {
    JsonParser,
    JsonLinesParser,
    PrefixedJsonParser,
    PrefixFilter,
    createDecodedInput,
} from '../src/index';
import type { ByteInputSink } from '../src/types';

const factories = [
    [
        'decoded core',
        () => {
            const parser = new JsonParser();
            return { parser, input: createDecodedInput(parser), text: '{"text":"П😀漢字"}' };
        },
    ],
    [
        'JSONL',
        () => {
            const parser = new JsonLinesParser();
            return { parser, input: parser, text: '{"text":"П😀漢字"}\n' };
        },
    ],
    [
        'prefix manager',
        () => {
            const parser = new PrefixedJsonParser('data:');
            return { parser, input: parser, text: 'data:{"text":"П😀漢字"}' };
        },
    ],
    [
        'prefix filter',
        () => {
            const parser = new JsonParser();
            return {
                parser,
                input: new PrefixFilter(parser, 'data:'),
                text: 'data:{"text":"П😀漢字"}',
            };
        },
    ],
] as const;

for (const [name, make] of factories) {
    test(`${name}: optional final text or bytes complete every chunk cut`, () => {
        const text = make().text;
        for (const source of [text, new TextEncoder().encode(text)]) {
            for (let cut = 0; cut <= source.length; cut++) {
                const { parser, input } = make();
                const values: unknown[] = [];
                let completed = 0;
                parser.onValue('$', {
                    next: (value: unknown) => values.push(value),
                    complete: () => completed++,
                });
                const head = source.slice(0, cut),
                    tail = source.slice(cut);
                input.write(head);
                input.end(tail);
                expect(values).toEqual([{ text: 'П😀漢字' }]);
                expect(parser.finished).toBe(true);
                expect(completed).toBe(1);
                input.end();
                expect(completed).toBe(1);
                expect(() => input.end(tail)).toThrow();
            }
        }
    });
    test(`${name}: a rejected final chunk leaves input open for a valid retry`, () => {
        const { parser, input, text } = make();
        const values: unknown[] = [];
        parser.onValue('$', (value: unknown) => values.push(value));
        input.write(text.slice(0, 3));
        expect(() => input.end(new TextEncoder().encode(text.slice(3)))).toThrow(TypeError);
        expect(parser.closed).toBe(false);
        expect(() => input.end(42 as unknown as string)).toThrow(TypeError);
        input.end(text.slice(3));
        expect(values).toEqual([{ text: 'П😀漢字' }]);
    });
    test(`${name}: truncated final UTF-8 fails consumers exactly once`, () => {
        const { parser, input, text } = make();
        const errors: unknown[] = [];
        let completed = 0;
        parser.onValue('$', {
            next() {},
            error: (error) => errors.push(error),
            complete: () => completed++,
        });
        const bytes = new TextEncoder().encode(text);
        const emoji = bytes.indexOf(0xf0);
        input.write(bytes.slice(0, emoji));
        expect(() => input.end(bytes.slice(emoji, emoji + 2))).toThrow();
        expect(errors).toHaveLength(1);
        expect(parser.closed).toBe(true);
        expect(completed).toBe(0);
        expect(() => input.end()).toThrow();
    });
}

test('JSONL final chunk may contain multiple complete records and an unterminated last line', () => {
    const parser = new JsonLinesParser();
    const values: unknown[] = [];
    parser.onRecord((value) => values.push(value));
    parser.end('{"id":1}\n{"id":2}');
    expect(values).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parser.recordCount).toBe(2);
});

test('final input cannot re-enter an adapter from a callback', () => {
    const parser = new JsonParser();
    const input: ByteInputSink = createDecodedInput(parser);
    parser.onValue('$', () => {
        expect(() => input.end(' ')).toThrow(/re-entered/);
    });
    input.end('{}');
    expect(parser.finished).toBe(true);
});

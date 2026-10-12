import { expect, test } from '@jest/globals';
import { runInNewContext } from 'node:vm';
import {
    JsonParser,
    Json5Parser,
    JsonLinesParser,
    PrefixedJsonParser,
    PrefixFilter,
    createDecodedInput,
} from '../src/index';
import type { InputSink, ByteInputSink } from '../src/types';

const factories = [
    ['JSON', () => new JsonParser()],
    ['JSON5', () => new Json5Parser()],
    ['JSONL', () => new JsonLinesParser()],
    ['prefix manager', () => new PrefixedJsonParser('data:')],
    ['prefix filter', () => new JsonParser()],
    ['decoded JSON', () => new JsonParser()],
    ['decoded JSON5', () => new Json5Parser()],
] as const;
for (const [name, make] of factories) {
    function setup() {
        const parser = make();
        const input: InputSink | ByteInputSink =
            name === 'prefix filter'
                ? new PrefixFilter(parser, 'data:')
                : name.startsWith('decoded')
                  ? createDecodedInput(parser)
                  : parser;
        return { parser, input, prefix: name.startsWith('prefix') ? 'data:' : '' };
    }
    test(`${name}: invalid destroy arguments leave partial input and consumers intact`, () => {
        const { parser, input, prefix } = setup();
        const values: unknown[] = [],
            errors: unknown[] = [];
        let completed = 0;
        parser.onValue('$', {
            next: (value: unknown) => {
                values.push(value);
            },
            error: (error) => {
                errors.push(error);
            },
            complete: () => {
                completed++;
            },
        });
        input.write(prefix + '{"text":"hel');
        const invalid = [0, '', false, 1, 'failure', true, NaN, {}, [], () => {}, Symbol('error')];
        for (const error of invalid) {
            expect(() => input.destroy(error as Error)).toThrow(TypeError);
            expect(parser.closed).toBe(false);
            expect(errors).toEqual([]);
        }
        input.write('lo"}\n');
        input.end();
        expect(values).toEqual([{ text: 'hello' }]);
        expect(completed).toBe(1);
        for (const error of invalid) expect(() => input.destroy(error as Error)).toThrow(TypeError);
        input.destroy();
        expect(completed).toBe(1);
        expect(errors).toEqual([]);
    });
    test(`${name}: Error identity and null/undefined cancellation are preserved`, () => {
        for (const error of [
            new Error('stop'),
            new TypeError('stop'),
            runInNewContext('new TypeError("other realm")') as Error,
            null,
            undefined,
        ]) {
            const { parser, input, prefix } = setup();
            let received: unknown,
                completed = 0;
            parser.onValue('$', {
                next() {},
                error: (value) => {
                    received = value;
                },
                complete: () => {
                    completed++;
                },
            });
            input.write(prefix + '[');
            input.destroy(error);
            if (error) expect(received).toBe(error);
            else {
                expect(received).toBeInstanceOf(Error);
                expect((received as Error).name).toBe('AbortError');
            }
            expect(completed).toBe(0);
            expect(parser.closed).toBe(true);
            expect(parser.finished).toBe(false);
            input.destroy();
        }
    });
}

test('invalid decoded-input cancellation preserves pending UTF-8 bytes', () => {
    const parser = new JsonParser(),
        input = createDecodedInput(parser);
    let value: unknown;
    parser.onValue('$', (next) => {
        value = next;
    });
    input.write(Uint8Array.of(34, 0xe2));
    expect(() => input.destroy(false as unknown as Error)).toThrow(TypeError);
    input.write(Uint8Array.of(0x82, 0xac, 34));
    input.end();
    expect(value).toBe('€');
});

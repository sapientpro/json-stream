import { expect, test } from '@jest/globals';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
    JsonParser,
    Json5Parser,
    JsonLinesParser,
    PrefixedJsonParser,
    PrefixFilter,
    createParser,
    createDecodedInput,
} from '../src/index';
import { JsonStream } from '../src/node';
import type { FormatOptions } from '../src/types';

for (const make of [
    () => new JsonParser(),
    () => new Json5Parser(),
    () => new JsonLinesParser(),
    () => new PrefixedJsonParser('data:'),
]) {
    test(`${make().constructor.name}: destroy rejects pending values instead of reporting EOF`, async () => {
        const parser = make(),
            events: string[] = [];
        parser.onValue('$', {
            next() {},
            complete: () => events.push('complete'),
            error: (error) => events.push((error as Error).name),
        });
        const value = parser.getValue();
        const rejected = expect(value).rejects.toMatchObject({ name: 'AbortError' });
        parser.destroy();
        parser.destroy(new Error('second'));
        expect(events).toEqual(['AbortError']);
        expect(parser.finished).toBe(false);
        await rejected;
    });
}
for (const Parser of [JsonParser, Json5Parser]) {
    test(`${Parser.name}: truncated string streams error and successful EOF remains complete`, async () => {
        const parser = new Parser(),
            reader = parser.stringStream('$').getReader();
        parser.write('"he');
        expect(await reader.read()).toEqual({ done: false, value: 'he' });
        const pending = reader.read(),
            rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        parser.destroy();
        await rejected;
        const good = new Parser(),
            events: string[] = [];
        good.onValue('$', {
            next() {},
            complete: () => events.push('complete'),
            error: () => events.push('error'),
        });
        good.end('{}');
        good.destroy();
        expect(events).toEqual(['complete']);
        expect(good.finished).toBe(true);
    });
}
test('Node cancellation propagates AbortError to consumers', async () => {
    const stream = new JsonStream(),
        value = stream.getValue();
    const rejected = expect(value).rejects.toMatchObject({ name: 'AbortError' });
    stream.write('[1,');
    stream.destroy();
    await rejected;
    expect(stream.parsed).toBe(false);
});
test('pipeline and first-value promises are observed together on invalid input', async () => {
    const stream = new JsonStream();
    await expect(
        Promise.all([
            stream.getValue('$.settings'),
            pipeline(Readable.from(['{"settings" 1}']), stream),
        ]),
    ).rejects.toThrow(SyntaxError);
});
for (const make of [
    () => new JsonLinesParser(),
    () => new PrefixedJsonParser('data:'),
    () => new PrefixFilter(new JsonParser(), 'data:'),
]) {
    test(`${make().constructor.name}: invalid input types do not choose a transport mode or close input`, () => {
        for (const valid of ['text', 'bytes']) {
            const target = make();
            for (const invalid of [undefined, null, 42, {}, [], new ArrayBuffer(1)])
                expect(() => target.write(invalid as string)).toThrow(TypeError);
            expect(target.closed).toBe(false);
            const text = target instanceof JsonLinesParser ? '1\n' : 'data:1';
            target.write(valid === 'text' ? text : new TextEncoder().encode(text));
            target.end();
            expect(target.finished).toBe(true);
        }
    });
}
test('all parser factories reject invalid option containers and option values', () => {
    const factories = [
        createParser,
        (o: FormatOptions) => new JsonParser(o),
        (o: FormatOptions) => new Json5Parser(o),
        (o: FormatOptions) => new JsonLinesParser(o),
        (o: FormatOptions) => new PrefixedJsonParser('data:', o),
        (o: FormatOptions) => new JsonStream(o),
    ];
    for (const make of factories) {
        for (const options of [
            null,
            5,
            'json',
            [],
            () => {},
            { collectJson: 'yes' },
            { onObserverError: 'x' },
            { onObserverError: null },
        ])
            expect(() => make(options as FormatOptions)).toThrow(TypeError);
    }
});
test('compact JSONL accounts for source size on each record, including split lines and fragments', () => {
    const lines = new JsonLinesParser({ memoryMode: 'compact' });
    const policies: boolean[] = [],
        values: string[] = [],
        fragments: string[] = [];
    lines.onValue('$.label', (value) => {
        values.push(value);
        const parser = (lines as unknown as { parser: { _copyPolicy: { large: boolean } } }).parser;
        policies.push(parser._copyPolicy.large);
    });
    lines.onString('$.label', (value) => fragments.push(value));
    const input = createDecodedInput(lines);
    input.write(new TextEncoder().encode('{"label":"start'));
    const text = '-end"}\n' + '{"label":"😀abcdef"}\n'.repeat(4000);
    expect(text.length).toBeGreaterThan(65536);
    input.write(new TextEncoder().encode(text));
    lines.end();
    expect(policies.every(Boolean)).toBe(true);
    expect(values).toHaveLength(4001);
    expect(values[0]).toBe('start-end');
    expect(fragments.join('')).toBe(values.join(''));
});

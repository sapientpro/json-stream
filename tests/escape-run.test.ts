import { decodedInput } from './input';
import { captureRoot, capturedRoot } from './capture';
import { test, expect } from '@jest/globals';
import { JsonParser, JsonLinesParser, PrefixedJsonParser } from '../src/index';
const encoder = new TextEncoder();
const raw = 'x'.repeat(96) + '\\uD83D\\uDE00' + '\\n\\t\\\\\\"\\/\\b\\f\\r'.repeat(40) + '\\uD800';
const input = '{"s":"' + raw + '"}';
const expected = JSON.parse(input);

test('batched complete escapes preserve values, fragments and surrogate cuts at every byte split', () => {
    const bytes = encoder.encode(input);
    for (let cut = 0; cut <= bytes.length; cut++) {
        const p = captureRoot(new JsonParser());
        let text = '';
        const pieces: string[] = [];
        p.onString(['s'], (v) => {
            text += v;
            pieces.push(v);
        });
        decodedInput(p).write(bytes.subarray(0, cut));
        decodedInput(p).write(bytes.subarray(cut));
        decodedInput(p).end();
        expect(capturedRoot(p)).toEqual(expected);
        expect(text).toBe(expected.s);
        for (let i = 0; i < pieces.length - 1; i++)
            expect(pieces[i]!.charCodeAt(pieces[i]!.length - 1)).not.toBe(0xd83d);
    }
});

test('control characters and invalid/truncated escapes after eligible runs are rejected', () => {
    for (const bad of [
        ...Array.from({ length: 32 }, (_, n) => String.fromCharCode(n)),
        '\\q',
        '\\u12xz',
        '\\u123',
        '\\u',
        '\\',
    ]) {
        for (const observeValue of [false, true]) {
            const p = new JsonParser({});
            if (observeValue) p.onValue('$', () => {});
            else p.onString(['ignored'], () => {});
            const text =
                '{"ignored":"' +
                'x'.repeat(96) +
                '\\n' +
                'y'.repeat(96) +
                bad +
                'z'.repeat(300) +
                '"}';
            expect(() => {
                p.write(text);
                p.end();
            }).toThrow(SyntaxError);
        }
    }
});

test('batching protects canceled fragments and retained values across reset and prefix boundaries', () => {
    const p = captureRoot(new JsonParser());
    let calls = 0;
    const sub = p.onString(['s'], () => {
        calls++;
        sub.unsubscribe();
    });
    for (let pos = 0; pos < input.length; pos += 512) p.write(input.slice(pos, pos + 512));
    expect(calls).toBe(1);
    expect(capturedRoot(p)).toEqual(expected);
    p.reset();
    p.write(input);
    p.end();
    expect(capturedRoot(p)).toEqual(expected);
    expect(calls).toBe(1);
    for (const manager of [new JsonLinesParser(), new PrefixedJsonParser('@')]) {
        const values: unknown[] = [];
        manager.onRecord((v) => values.push(v));
        manager.write(
            manager instanceof JsonLinesParser ? input + '\n' + input : '@' + input + '@' + input,
        );
        manager.end();
        expect(values).toEqual([expected, expected]);
    }
});

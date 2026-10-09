import {expect, test} from '@jest/globals';
import {JsonParser} from '../src/index';

const body = 'a\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\\uD83D\\uDE00z';
const doc = '{"' + body + '":"' + body + '"}';

test('pending escapes preserve keys, retained values and surrogate-safe fragments at every pair of cuts', () => {
    const expected = JSON.parse(doc), key = Object.keys(expected)[0]!;
    for (let a = 0; a <= doc.length; ++a) for (let b = a; b <= doc.length; ++b) {
        const p = new JsonParser();
        let root: unknown, streamed = '', ends = 0;
        p.onValue('$', value => root = value);
        p.onString([key], {next: part => {
            expect(/[\uD800-\uDBFF]$/.test(part)).toBe(false);
            streamed += part;
        }, end: () => ++ends});
        p.write(doc.slice(0, a)); p.write(doc.slice(a, b)); p.end(doc.slice(b));
        expect(root).toEqual(expected);
        expect(streamed).toBe(expected[key]);
        expect(ends).toBe(1);
    }
});

test('pending Unicode escape waits for all digits without emitting them', () => {
    const p = new JsonParser(), fragments: string[] = [];
    p.onString('$', part => fragments.push(part));
    p.write('"prefix\\uZ');
    p.write('0'); p.write(''); p.write('0');
    expect(fragments.join('')).toBe('prefix');
    expect(() => p.write('0')).toThrow(SyntaxError);
    expect(() => p.end()).toThrow(SyntaxError);
});

test('incomplete escapes fail at EOF and cannot be reset after failure', () => {
    for (const tail of ['\\', '\\u', '\\u0', '\\u00', '\\u004']) {
        const p = new JsonParser();
        p.write('"' + tail);
        expect(() => p.end()).toThrow(SyntaxError);
        expect(() => p.reset()).toThrow(SyntaxError);
    }
});

test('managed input returns the exact unread suffix after a pending escape', () => {
    const p = new JsonParser({strictEnd: false});
    let value: unknown;
    p.onValue('$', v => value = v);
    p.write('"\\uD83'); p.write('D\\uDE');
    expect(p.write('00" next')).toBe(5);
    expect(value).toBe('😀');
    expect(() => p.write('')).toThrow('reset');
});

test('reset after a completed split escape preserves subscriptions', () => {
    const p = new JsonParser(), values: unknown[] = [];
    p.onValue('$', v => values.push(v));
    p.write('"\\u00'); p.write('41"'); p.reset();
    p.end('"clean"');
    expect(values).toEqual(['A', 'clean']);
});

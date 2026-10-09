import { expect, test } from '@jest/globals';
import JSON5 from 'json5';
import { Json5Parser } from '../src/index';

for (const quote of ['"', "'"]) {
    const body =
        String.raw`a\x41\u0042\uD83D\uDE00\0z\v\n\r\t\b\f\/\\\q\"\'` +
        '\\\r\n' +
        'c' +
        '\\\u2028' +
        'd';
    const doc = '{' + quote + body + quote + ':' + quote + body + quote + '}';
    test('JSON5 strings and keys survive every pair of cuts with ' + quote, () => {
        const expected = JSON5.parse(doc),
            key = Object.keys(expected)[0]!;
        for (let a = 0; a <= doc.length; ++a)
            for (let b = a; b <= doc.length; ++b) {
                const p = new Json5Parser();
                let root: unknown,
                    text = '',
                    ends = 0;
                p.onValue('$', (value) => (root = value));
                p.onString([key], {
                    next: (part) => {
                        expect(/[\uD800-\uDBFF]$/.test(part)).toBe(false);
                        text += part;
                    },
                    end: () => ++ends,
                });
                p.write(doc.slice(0, a));
                p.write(doc.slice(a, b));
                p.end(doc.slice(b));
                expect(root).toEqual(expected);
                expect(text).toBe(expected[key]);
                expect(ends).toBe(1);
            }
    });
}

test('invalid JSON5 escapes fail across every cut, including unfinished input', () => {
    for (const body of [
        String.raw`\xG0`,
        String.raw`\x0Z`,
        String.raw`\uZ000`,
        String.raw`\u000Z`,
        String.raw`\01`,
        String.raw`\9`,
        '\\',
        '\\x',
        '\\x0',
        '\\u',
        '\\u0',
        '\\u00',
        '\\u000',
    ]) {
        for (const quote of ['"', "'"])
            for (const close of ['', quote]) {
                const doc = quote + body + close;
                expect(() => JSON5.parse(doc)).toThrow();
                for (let cut = 0; cut <= doc.length; ++cut) {
                    const p = new Json5Parser();
                    expect(() => {
                        p.write(doc.slice(0, cut));
                        p.end(doc.slice(cut));
                    }).toThrow(SyntaxError);
                }
            }
    }
});

test('split JSON5 escapes preserve reset bindings and managed tails', () => {
    const p = new Json5Parser({ strictEnd: false }),
        values: unknown[] = [];
    p.onValue('$', (value) => values.push(value));
    p.write("'\\x");
    p.write('4');
    expect(p.write("1' next")).toBe(5);
    p.reset();
    p.write("'\\uD83");
    p.write('D\\uDE');
    expect(p.end("00' tail")).toBe(5);
    expect(values).toEqual(['A', '😀']);
});

test('cancellation in a JSON5 escape fragment stops that consumer only', () => {
    const p = new Json5Parser(),
        fragments: string[] = [];
    let root: unknown;
    p.onValue('$', (value) => (root = value));
    const sub = p.onString('$', (part) => {
        fragments.push(part);
        sub.unsubscribe();
    });
    p.write("'\\x");
    p.write('41');
    expect(fragments).toEqual(['A']);
    p.end("\\u0042'");
    expect(fragments).toEqual(['A']);
    expect(root).toBe('AB');
});

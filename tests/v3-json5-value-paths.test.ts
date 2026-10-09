import {expect, test} from '@jest/globals';
import JSON5 from 'json5';
import {Json5Parser, Any} from '../src/v3/index';

const numeric = ['-0', '+0', '.5', '-.5', '1.', '1.e+2', '-0xFF', '+0Xf', 'Infinity', '-Infinity', '+NaN', '-NaN', '1e-300', '123456789012345678901234567890'];
test('JSON5 number selection preserves conversion, paths and retained parents across cuts', () => {
    const doc = '{skip:[' + numeric.join(',') + '],items:[' + numeric.map((n, i) => '{id:' + i + ',value:' + n + '}').join(',') + ']}';
    const expected = JSON5.parse(doc);
    for (const size of [1, 2, 3, 7, 32, 65536]) for (const retain of [false, true]) {
        const p = new Json5Parser(), values: unknown[] = [], paths: unknown[] = [];
        let root: unknown;
        if (retain) p.onValue('$', value => root = value);
        p.onValue('$.skip[*].missing', () => { throw new Error('Scalar has no child'); });
        p.onValue(['items', Any, 'value'], (value, path) => {values.push(value); paths.push(path);});
        for (let at = 0; at < doc.length; at += size) p.write(doc.slice(at, at + size));
        p.end();
        expect(values).toEqual(expected.items.map((item: any) => item.value));
        expect(paths).toEqual(expected.items.map((_: any, i: number) => ['items', i, 'value']));
        if (retain) expect(root).toEqual(expected);
    }
});

test('unselected JSON5 numbers and literal prefixes are still validated at every cut', () => {
    for (const token of ['01', '0x', '0xG', '1e+', '1.2.3', '+', 'Infinityx', 'NaN0', 'truex', 'true0', 'false+1', 'null.', 'null\\u0061']) {
        const doc = '{skip:' + token + ',selected:1}';
        expect(() => JSON5.parse(doc)).toThrow();
        for (let cut = 0; cut <= doc.length; ++cut) for (const retain of [false, true]) {
            const p = new Json5Parser();
            p.onValue(retain ? '$' : '$.selected', () => {});
            expect(() => {p.write(doc.slice(0, cut)); p.end(doc.slice(cut));}).toThrow(SyntaxError);
        }
    }
});

test('JSON5 literal boundaries include comments and Unicode whitespace', () => {
    for (const gap of [',', '/*comment*/,', '//comment\n,', '\u00a0,', '\u2028,', '\u2029,']) {
        const doc = '[true' + gap + 'false' + gap + 'null]';
        for (let cut = 0; cut <= doc.length; ++cut) {
            const p = new Json5Parser(), values: unknown[] = [];
            p.onValue('$[*]', value => values.push(value));
            p.write(doc.slice(0, cut)); p.end(doc.slice(cut));
            expect(values).toEqual([true, false, null]);
        }
    }
});

test('quoted key fast paths preserve prototype keys, escapes, long names and reset', () => {
    const docs = [
        '{"":1,\'__proto__\':{x:2},"constructor":3,"toString":4,\'a\\x62\':5,"' + 'long'.repeat(30) + '":6}',
        '{"first":true,\'second\':null}',
    ];
    for (const size of [1, 2, 3, 16, 32, 65536]) for (const memoryMode of ['fast', 'compact'] as const) {
        const p = new Json5Parser({memoryMode}), roots: unknown[] = [];
        p.onValue('$', value => roots.push(value));
        for (let i = 0; i < docs.length; ++i) {
            const doc = docs[i]!;
            for (let at = 0; at < doc.length; at += size) p.write(doc.slice(at, at + size));
            if (i + 1 < docs.length) p.reset(); else p.end();
        }
        expect(roots).toEqual(docs.map(doc => JSON5.parse(doc)));
        expect(Object.getPrototypeOf(roots[0])).toBe(Object.prototype);
    }
});

test('literal prefixes do not emit until a JSON5 token boundary is known', () => {
    for (const doc of ['true0', 'falsex', 'nullé', 'true\\u0061']) for (let cut = 0; cut <= doc.length; ++cut) {
        const p = new Json5Parser(), values: unknown[] = [];
        p.onValue('$', value => values.push(value));
        expect(() => {p.write(doc.slice(0, cut)); p.end(doc.slice(cut));}).toThrow(SyntaxError);
        expect(values).toEqual([]);
    }
});

test('destroy in a fast literal callback stops further processing', () => {
    const p = new Json5Parser(), values: unknown[] = [];
    p.onValue('$[*]', value => {values.push(value); p.destroy();});
    expect(() => p.end('[true, invalid]')).not.toThrow();
    expect(values).toEqual([true]);
    expect(p.closed).toBe(true);
});

test('cached numeric decisions respect unsubscribe and retained parents across reset', () => {
    for (const retain of [false, true]) {
        const p = new Json5Parser(), selected: unknown[] = [], roots: unknown[] = [];
        if (retain) p.onValue('$', value => roots.push(value));
        const sub = p.onValue('$[*].value', value => {selected.push(value); sub.unsubscribe();});
        const doc = '[{value:-0xFF},{value:1.e2},{value:-Infinity},{value:NaN}]';
        p.write(doc); p.reset(); p.end(doc);
        expect(selected).toEqual([-255]);
        expect(roots).toEqual(retain ? [JSON5.parse(doc), JSON5.parse(doc)] : []);
    }
});

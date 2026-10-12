import { expect, test } from '@jest/globals';
import JSON5 from 'json5';
import { Json5Parser, createDecodedInput, JsonLinesParser, PrefixedJsonParser } from '../src/index';

const comments = [
    '/**/',
    '/****/',
    '/* *x** ***/',
    '/*/ not closed here */',
    '/* π😀\n\r\u2028\u2029 */',
    ...['\n', '\r', '\r\n', '\u2028', '\u2029'].map((end) => '// π😀 */ ignored' + end),
];

test('JSON5 comment delimiters and line endings survive every text and UTF-8 cut', () => {
    for (const comment of comments) {
        const source = `${comment}{ignored:{a:${comment}1},text:${comment}'π😀'}${comment}`;
        const expected = JSON5.parse(source);
        for (const selected of [false, true])
            for (const data of [source, new TextEncoder().encode(source)])
                for (let cut = 0; cut <= data.length; ++cut) {
                    const parser = new Json5Parser({ collectJson: true });
                    const input = createDecodedInput(parser);
                    let root: unknown;
                    const parts: string[] = [];
                    if (!selected) parser.onValue('$', (value) => (root = value));
                    parser.onString('$.text', (part) => parts.push(part));
                    input.write(data.slice(0, cut));
                    input.write(data.slice(cut));
                    input.end();
                    if (!selected) expect(root).toEqual(expected);
                    expect(parts.join('')).toBe(expected.text);
                    expect(parser.json).toBe(source);
                }
    }
});

test('one-byte comments preserve split stars, CRLF and following string delivery', () => {
    const source = "/*leading**/{ignored:{a:/*body***/1},text://line\r\n'π😀'}// eof";
    const parser = new Json5Parser();
    const input = createDecodedInput(parser);
    const parts: string[] = [];
    parser.onString('$.text', (part) => parts.push(part));
    for (const byte of new TextEncoder().encode(source)) input.write(Uint8Array.of(byte));
    input.end();
    expect(parts.join('')).toBe('π😀');
});

test('unterminated comments and invalid slash prefixes fail even in unobserved objects', () => {
    for (const source of [
        '/*/',
        '/**',
        '/',
        '/x{}',
        '{}/*',
        '{}/* *',
        '{ignored:{a:/*/1},text:1}',
        '{ignored:{a:/x1},text:1}',
    ])
        for (let cut = 0; cut <= source.length; ++cut) {
            const parser = new Json5Parser();
            parser.onValue('$.text', () => {});
            expect(() => {
                parser.write(source.slice(0, cut));
                parser.end(source.slice(cut));
            }).toThrow(SyntaxError);
        }
});

test('comments resume document managers and EOF line comments without affecting marker search', () => {
    for (const parser of [
        new JsonLinesParser({ format: 'json5' }),
        new PrefixedJsonParser('START', { format: 'json5' }),
    ]) {
        const values: unknown[] = [];
        parser.onValue('$.text', (value) => values.push(value));
        const source =
            parser instanceof JsonLinesParser
                ? "{ignored:{a:/* **/1},text:'a'}// tail\r\n{text:'b'}// eof"
                : "START/*x*/{text:'a'}START/*y*/{text:'b'}";
        for (const ch of source) parser.write(ch);
        parser.end();
        expect(values).toEqual(['a', 'b']);
    }
});

test('large comment runs preserve stars at chunk edges and reject missing closure', () => {
    for (const comment of ['/*' + '*'.repeat(20000) + '/', '//' + 'π'.repeat(20000) + '\u2029']) {
        const source = '{ignored:{a:' + comment + "1},text:'tail'}";
        const bodyStart = source.indexOf(comment);
        for (const cut of [
            0,
            bodyStart + 1,
            bodyStart + 2,
            bodyStart + comment.length - 2,
            bodyStart + comment.length - 1,
            bodyStart + comment.length,
            source.length,
        ]) {
            const parser = new Json5Parser();
            let value: unknown;
            parser.onValue('$.text', (v) => (value = v));
            parser.write(source.slice(0, cut));
            parser.end(source.slice(cut));
            expect(value).toBe('tail');
        }
    }
    const unfinished = new Json5Parser();
    unfinished.write('/*' + '*'.repeat(20000));
    expect(() => unfinished.end()).toThrow(SyntaxError);
});

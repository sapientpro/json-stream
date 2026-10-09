import { expect, test } from '@jest/globals';
import { JsonLinesParser, PrefixedJsonParser } from '../src/index';

for (const kind of ['lines', 'prefix'] as const) {
    test(`${kind}: record context survives cuts, EOF and failure replay`, () => {
        for (const text of kind === 'lines'
            ? ['{}\r\n{x}\n', '{}\n{"x":']
            : ['START{}START{x}', 'START{}START{"x":']) {
            for (let cut = 0; cut <= text.length; cut++) {
                const parser =
                    kind === 'lines' ? new JsonLinesParser() : new PrefixedJsonParser('START');
                const errors: unknown[] = [];
                parser.onValue('$', { next() {}, error: (error) => errors.push(error) });
                let failure: unknown;
                try {
                    parser.write(text.slice(0, cut));
                    parser.write(text.slice(cut));
                    parser.end();
                } catch (error) {
                    failure = error;
                }
                expect(failure).toBeInstanceOf(SyntaxError);
                expect((failure as Error).message).toContain('(record index 1)');
                expect((failure as Error).cause).toBeInstanceOf(SyntaxError);
                expect(errors).toEqual([failure]);
                expect(parser.recordCount).toBe(1);
                try {
                    parser.write('');
                } catch (error) {
                    expect(error).toBe(failure);
                }
            }
        }
    });
}
test('first-record framing failures also carry index zero', () => {
    expect(() => new JsonLinesParser().write('\ufeff{}')).toThrow('record index 0');
    expect(() => new PrefixedJsonParser('START').end()).toThrow('record index 0');
});

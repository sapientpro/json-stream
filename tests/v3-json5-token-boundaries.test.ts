import {describe, expect, test} from '@jest/globals';
import {Json5Parser} from '../src/v3/index';

describe('JSON5 token and string delimiter boundaries', () => {
    test.each(['text', 'bytes'] as const)('preserves Unicode identifiers, whitespace and escapes across every %s cut', input => {
        const source = "{𝒜\u00a0:1,foo\\u006f\u2028:-0x10,infinity:Infinity,nan:NaN,text:'prefix0123456789\\nend\\x41',line:'prefix0123456789\\\r\ncontinued',}";
        const data = input === 'text' ? source : new TextEncoder().encode(source);
        const expected = {𝒜: 1, fooo: -16, infinity: Infinity, nan: NaN, text: 'prefix0123456789\nendA', line: 'prefix0123456789continued'};
        for (let cut = 0; cut <= data.length; ++cut) {
            const parser = new Json5Parser(); const fragments: string[] = []; let root: unknown;
            parser.onValue('$', value => {root = value;});
            parser.onString('$.text', part => fragments.push(part));
            parser.write(data.slice(0, cut)); parser.write(data.slice(cut)); parser.end();
            expect(root).toEqual(expected); expect(fragments.join('')).toBe(expected.text);
        }
    });
});

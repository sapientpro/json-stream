import {expect, test} from '@jest/globals';
import {Any, JsonParser} from '../src/parser';

test('ignored strings preserve escaped keys, retained values and streamed surrogate pairs at every byte cut', () => {
  const input = '{"ignored":"a\\n\\t\\u0041\\uD83D\\uDE00😀","escaped\\nkey":"kept\\n😀",'
    + '"parts":["a\\uD83D\\uDE00b","c\\n\\u0041"],"tail":"discarded\\uD800"}';
  const bytes = new TextEncoder().encode(input);
  for (let cut = 0; cut <= bytes.length; cut++) {
    const parser = new JsonParser({retainRoot: false});
    const kept: unknown[] = [], pieces: string[] = [];
    parser.observe(['escaped\nkey']).subscribe(event => kept.push(event));
    parser.chunks(['parts', Any]).subscribe(fragment => pieces.push(fragment));
    parser.write(bytes.subarray(0, cut));
    parser.write(bytes.subarray(cut));
    parser.end();
    expect(kept).toEqual([{path: ['escaped\nkey'], value: 'kept\n😀'}]);
    expect(pieces.join('')).toBe('a😀bc\nA');
    for (const piece of pieces) {
      const last = piece.charCodeAt(piece.length - 1);
      expect(last >= 0xD800 && last <= 0xDBFF).toBe(false);
    }
    expect(parser.root).toBeUndefined();
  }
});

test.each(['\\uZZZZ', '\\u12', '\\', 'unfinished'])
('ignored malformed string still fails: %s', malformed => {
  const input = '{"ignored":"' + malformed + (malformed === '\\uZZZZ' ? '","tail":1}' : '');
  for (let cut = 0; cut <= input.length; cut++) {
    const parser = new JsonParser({retainRoot: false});
    expect(() => {
      parser.write(input.slice(0, cut));
      parser.write(input.slice(cut));
      parser.end();
    }).toThrow(SyntaxError);
  }
});

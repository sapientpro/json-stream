/// <reference types="jest" />
import {JsonParser} from '../src/parser';

test('a split immediately after u delivers the preceding string fragment', () => {
  const parser = new JsonParser({retainRoot: false}), pieces: string[] = [];
  parser.chunks('text').subscribe(piece => pieces.push(piece));
  parser.write('{"text":"prefix\\u');
  expect(pieces).toEqual(['prefix']);
  parser.write('D83D\\uDE00tail"}');
  parser.end();
  expect(pieces).toEqual(['prefix', '😀tail']);
});

test('mixed escape spans preserve roots and fragments at every byte split', () => {
  const source = '{"text":"a\\n\\t\\r\\b\\f\\\\\\"\\/\\u0414\\uD83D\\uDE00z"}';
  const expected = JSON.parse(source), bytes = new TextEncoder().encode(source);
  for (let split = 0; split <= bytes.length; ++split) {
    const parser = new JsonParser(), pieces: string[] = [];
    parser.chunks('text').subscribe(piece => pieces.push(piece));
    parser.write(bytes.subarray(0, split));
    parser.write(bytes.subarray(split));
    parser.end();
    expect(parser.root).toEqual(expected);
    expect(pieces.join('')).toBe(expected.text);
    for (let i = 0; i < pieces.length - 1; ++i) {
      const last = pieces[i].charCodeAt(pieces[i].length - 1);
      expect(last >= 0xD800 && last <= 0xDBFF).toBe(false);
    }
  }
});

test('escaped object keys and a long sequence of escapes preserve values', () => {
  const source = '{"\\u005f\\u005fproto__":{"a\\nkey":"' + '\\u0041\\n'.repeat(1000) + '"}}';
  const parser = new JsonParser();
  parser.write(source);
  parser.end();
  expect(parser.root).toEqual(JSON.parse(source));
  expect(Object.getPrototypeOf(parser.root)).toBe(Object.prototype);
  expect(Object.hasOwn(parser.root, '__proto__')).toBe(true);
});

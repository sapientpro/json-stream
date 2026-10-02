import {Any, JsonParser} from '../src/parser';
import {expect, test} from '@jest/globals';

test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
('exact and wildcard observers match prototype-named key %s', key => {
  const parser = new JsonParser({retainRoot: false});
  const exact: unknown[] = [], wildcard: unknown[] = [], fragments: string[] = [];
  parser.observe([key, 'text']).subscribe(event => exact.push(event));
  parser.observe([Any, 'text']).subscribe(event => wildcard.push(event));
  parser.chunks([key, 'text']).subscribe(fragment => fragments.push(fragment));
  const input = '{"' + key + '":{"text":"a\\uD83D\\uDE00b"},"other":{"text":"c"}}';
  for (const byte of new TextEncoder().encode(input)) parser.write(Uint8Array.of(byte));
  parser.end();
  expect(exact).toEqual([{path: [key, 'text'], value: 'a😀b'}]);
  expect(wildcard).toEqual([...exact, {path: ['other', 'text'], value: 'c'}]);
  expect(fragments.join('')).toBe('a😀b');
  expect(parser.root).toBeUndefined();
});

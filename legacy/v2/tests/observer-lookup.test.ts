import {Any, JsonParser, Rest} from '../src/parser';
import {expect, test} from '@jest/globals';

test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'any', 'rest'])
('exact and wildcard observers match named key %s', key => {
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

test('wildcard edges registered in an exact callback participate in the same dispatch', () => {
  const parser = new JsonParser();
  const seen: string[] = [], completed: string[] = [];
  parser.observe(['items', 0]).subscribe(({value}) => {
    seen.push(`exact:${value}`);
    parser.observe(['items', Any]).subscribe({
      next: ({value}) => seen.push(`any:${value}`),
      complete: () => completed.push('any'),
    });
    parser.observe(['items', Rest]).subscribe({
      next: ({value}) => seen.push(`rest:${value}`),
      complete: () => completed.push('rest'),
    });
  });
  parser.write('{"items":[1,2]}');
  parser.end();
  expect(seen).toEqual(['exact:1', 'any:1', 'rest:1', 'any:2', 'rest:2']);
  expect(completed).toEqual(['any', 'rest']);
  expect(parser.root).toEqual({items: [1, 2]});
});

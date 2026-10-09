import {expect, test} from '@jest/globals';
import {Any, JsonParser, Rest} from '../src/parser';

test.each([1, 7, 65536])('overlapping retention paths keep complete subtrees, chunk=%s', size => {
  const parser = new JsonParser({retainRoot: false});
  const exact: unknown[] = [], any: unknown[] = [], rest: unknown[] = [];
  parser.observe(['items', 0]).subscribe(({value}) => exact.push(value));
  parser.observe(['items', Any, 'id']).subscribe(({value}) => any.push(value));
  parser.observe(['items', Rest]).subscribe(({value, path}) => rest.push({value, path}));
  const items = [{id: 1, detail: {text: '😀\n', list: [2, null]}}, {id: 3}];
  const bytes = new TextEncoder().encode(JSON.stringify({ignored: ['discard'], items}));
  for (let i = 0; i < bytes.length; i += size) parser.write(bytes.subarray(i, i + size));
  parser.end();
  expect(exact).toEqual([items[0]]);
  expect(any).toEqual([1, 3]);
  expect(rest).toContainEqual({path: ['items', 0], value: items[0]});
  expect(rest).toContainEqual({path: ['items', 1], value: items[1]});
  expect(parser.root).toBeUndefined();
});

test('retention falls back to Rest when an exact prefix does not match', () => {
  const parser = new JsonParser({retainRoot: false});
  const seen: unknown[] = [];
  parser.observe(['data', 'nested', 'missing']).subscribe(() => { throw new Error('unexpected match'); });
  parser.observe(['data', Rest]).subscribe(event => seen.push(event));
  parser.write('{"data":{"nested":{"other":{"text":"kept"}}}}');
  parser.end();
  expect(seen).toContainEqual({path: ['data', 'nested'], value: {other: {text: 'kept'}}});
  expect(parser.root).toBeUndefined();
});

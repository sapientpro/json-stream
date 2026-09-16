/// <reference types="jest" />
import { JsonParser, Any, Rest } from '../src/parser';

const feed = (p: JsonParser, json: string, size = 1) => {
  for (let i = 0; i < json.length; i += size) p.write(json.slice(i, i + size));
  p.end();
};

test.each([1, 3, 64, 1e9])('round-trips at chunk size %p', (size) => {
  const cases = [
    '{"a":-1,"b":[1,2,{"c":"x\\ty"}],"d":null,"e":true}',
    '[]', '{}', '[[],{},[[]]]', '[1.5e-3,-0.25,true,false,null]',
    '{"__proto__":{"p":1},"k":"\\u0414"}', '"plain"', '42', '{"a":{"b":{"c":[1,[2,[3]]]}}}',
  ];
  for (const json of cases) {
    const p = new JsonParser();
    feed(p, json, size);
    expect(JSON.stringify(p.root)).toBe(JSON.stringify(JSON.parse(json)));
  }
});

test.each([1, 2, 3, 5, 1e9])('escapes match JSON.parse at chunk size %p', (size) => {
  const B = String.fromCharCode(92), Q = String.fromCharCode(34);
  const valid = [
    B + Q, B + B, B + '/', B + 'b', B + 'f', B + 'n', B + 'r', B + 't',
    B + 'u0041', B + 'u0000', B + 'u00e9', B + 'uD83D' + B + 'uDE00',
    B + 'uD800', B + 'uDC00', B + B + 'u0041', 'e' + String.fromCharCode(233) + 'z',
  ];
  for (const body of valid) {
    const json = '{' + Q + 'k' + body + Q + ':' + Q + 'a' + body + 'b' + Q + '}';
    const p = new JsonParser();
    feed(p, json, size);
    expect(p.root).toEqual(JSON.parse(json));
  }
});

test.each([[String.fromCharCode(92) + 'u41'], [String.fromCharCode(92) + 'uZZZZ'], [String.fromCharCode(92)]])(
  'rejects %p as an escape', (body) => {
    const json = '"a' + body + '"';
    expect(() => feed(new JsonParser(), json, 1e9)).toThrow(SyntaxError);
  });

test('never splits a surrogate pair across chunks', () => {
  const encoder = new TextEncoder();
  for (const at of [6, 7, 8]) {
    const json = '{"s":"a' + String.fromCharCode(0xD83D, 0xDE00) + 'b"}';
    const p = new JsonParser();
    const parts: string[] = [];
    p.chunks(['s']).subscribe({next: c => parts.push(c)});
    p.write(json.slice(0, at));
    p.write(json.slice(at));
    p.end();
    const bytes = parts.flatMap(part => [...encoder.encode(part)]);
    expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe(p.root.s);
  }
});

test('still emits a lone trailing surrogate at the end of a string', () => {
  const p = new JsonParser();
  const parts: string[] = [];
  p.chunks(['s']).subscribe({next: c => parts.push(c)});
  feed(p, '{"s":"a' + String.fromCharCode(92) + 'uD800"}', 4);
  expect(parts.join('')).toBe(p.root.s);
  expect(p.root.s).toBe('a' + String.fromCharCode(0xD800));
});

test('destroy from an observer aborts the parse', () => {
  const p = new JsonParser();
  let seen: any = null;
  p.observe([Any]).subscribe({
    next: e => { if (e.value === 1) p.destroy(new Error('stop')); },
    error: e => { seen = e; },
  });
  p.write('[1,2]');
  expect(seen).toEqual(new Error('stop'));
  expect(p.finished).toBe(false);
  expect(p.root).toBeUndefined();
  expect(() => p.write('x')).toThrow('stop');
});

test.each(['write', 'end'] as const)('%s from an observer throws instead of corrupting state', (method) => {
  const p = new JsonParser();
  let inner: Error | null = null;
  p.observe([Any]).subscribe(e => {
    if (e.value !== 1) return;
    try { method === 'write' ? p.write('9') : p.end(); } catch (err) { inner = err as Error; }
  });
  p.write('[1,2]');
  p.end();
  expect(inner).toBeInstanceOf(Error);
  expect((inner as unknown as Error).message).toMatch(/re-entered from an observer callback/);
  expect(p.root).toEqual([1, 2]);
});

test('observes wildcard and rest', () => {
  const p = new JsonParser();
  const any: any[] = [], rest: any[] = [];
  p.observe([Any, 'a']).subscribe(v => any.push(v));
  p.observe([Rest]).subscribe(v => rest.push(v.path.join('.')));
  feed(p, '[{"a":1},{"a":2}]', 2);
  expect(any).toEqual([{path: [0, 'a'], value: 1}, {path: [1, 'a'], value: 2}]);
  expect(rest).toEqual(['0.a', '0', '1.a', '1']);
});

test('streams string chunks', async () => {
  const p = new JsonParser();
  const seen: string[] = [];
  p.chunks(['a']).subscribe({next: c => seen.push(c)});
  feed(p, '{"a":"hello world","b":1}', 4);
  expect(seen.join('')).toBe('hello world');
  expect(seen.length).toBeGreaterThan(1);
});

test('finds the start marker across chunks', () => {
  const p = new JsonParser({start: '```json'});
  p.write('chatter ``');
  p.write('`json {"a":1}');
  p.end();
  expect(p.root).toEqual({a: 1});
});

test.each([
  ['{"a":', 'truncated'],
  ['{"a":"x', 'unterminated string'],
  ['{ab":1}', 'unquoted key'],
  ['{"x":"\\u41"}', 'short escape'],
  ['tru', 'partial literal'],
])('rejects %s (%s)', (json) => {
  const p = new JsonParser();
  expect(() => feed(p, json, 1)).toThrow(SyntaxError);
});

test.each([
  ['[1 2]', [1, 2]],
  ['{"a":1,}', {a: 1}],
  ['[1,]', [1]],
  ['{"a":1 "b":2}', {a: 1, b: 2}],
  ['[007]', [7]],
])('stays lenient about %s', (json, expected) => {
  const p = new JsonParser();
  feed(p, json, 1);
  expect(p.root).toEqual(expected);
});

test('rejects a missing start marker', () => {
  const p = new JsonParser({start: '```json'});
  expect(() => feed(p, 'no fence at all', 1)).toThrow(/not found/);
});

test('caps nesting', () => {
  const p = new JsonParser({maxDepth: 50});
  expect(() => feed(p, '['.repeat(60), 1e9)).toThrow(/nesting deeper/);
});

test('errors observers with the real cause', async () => {
  const p = new JsonParser();
  const pending = p.value(['a']);
  expect(() => feed(p, '{"a": nope}', 1e9)).toThrow(SyntaxError);
  await expect(pending).rejects.toThrow(SyntaxError);
});

test('collects raw json only when asked', () => {
  const a = new JsonParser({collectJson: true});
  feed(a, '{"a":1}', 3);
  expect(a.json).toBe('{"a":1}');
  const b = new JsonParser();
  feed(b, '{"a":1}', 3);
  expect(b.json).toBe('');
});

test('decodes bytes split mid-character', () => {
  const p = new JsonParser();
  const bytes = Buffer.from('{"a":"привіт 🎉"}', 'utf8');
  for (const b of bytes) p.write(Uint8Array.of(b));
  p.end();
  expect(p.root).toEqual({a: 'привіт 🎉'});
});

/// <reference types="jest" />
import { JsonStream, Any } from '../src';

const feed = async (s: JsonStream, parts: (string | Buffer)[]) => {
  for (const p of parts) await new Promise<void>(r => s.write(p as any, undefined as any, () => r()));
  s.end();
};

test('parses negative numbers', async () => {
  const s = new JsonStream();
  const p = s.value();
  await feed(s, ['{"a":-1,"b":-2.5e-3}']);
  expect(await p).toEqual({ a: -1, b: -0.0025 });
});

test('multibyte characters split across chunks', async () => {
  const s = new JsonStream();
  const p = s.value();
  const buf = Buffer.from('{"a":"привіт 🎉"}', 'utf8');
  await feed(s, [buf.subarray(0, 9), buf.subarray(9)]);
  expect(await p).toEqual({ a: 'привіт 🎉' });
});

test('Any wildcard still fires when an explicit sibling path is observed', async () => {
  const s = new JsonStream();
  const explicit: any[] = [], any: any[] = [];
  s.observe(['a', 'b']).subscribe(v => explicit.push(v.value));
  s.observe([Any, 'b']).subscribe(v => any.push(v.value));
  const done = s.value();
  await feed(s, ['{"a":{"b":1},"c":{"b":2}}']);
  await done;
  expect(explicit).toEqual([1]);
  expect(any).toEqual([1, 2]);
});

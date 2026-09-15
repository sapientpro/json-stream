/// <reference types="jest" />
import { JsonStream, Any } from '../src';

const feed = async (s: JsonStream, parts: (string | Buffer)[]) => {
  for (const p of parts) await new Promise<void>(r => s.write(p as any, undefined as any, () => r()));
  s.end();
};

const caught = (s: JsonStream) => new Promise<any>(r => s.on('error', r));

describe('parsing', () => {
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

  test('emitted path keeps array indices as numbers', async () => {
    const s = new JsonStream();
    const paths: any[] = [];
    s.observe([Any, Any]).subscribe(v => paths.push(v.path));
    const done = s.value();
    await feed(s, ['{"a":[7]}']);
    await done;
    expect(paths).toEqual([['a', 0]]);
  });
});

describe('availability', () => {
  test('a missing start marker errors instead of hanging', async () => {
    const s = new JsonStream('```json');
    const err = caught(s);
    await feed(s, ['there is no fence in this reply']);
    expect(await err).toBeInstanceOf(SyntaxError);
    expect((await err).message).toMatch(/not found/);
  });

  test('a start marker split across chunks is still found', async () => {
    const s = new JsonStream('```json');
    const p = s.value();
    await feed(s, ['here it comes ``', '`json {"a":1}']);
    expect(await p).toEqual({ a: 1 });
  });

  test('nesting past the limit errors instead of exhausting the heap', async () => {
    const s = new JsonStream();
    const err = caught(s);
    await feed(s, ['['.repeat(4000)]);
    expect((await err).message).toMatch(/nesting deeper/);
  });

  test('a syntax error rejects value() with the real cause', async () => {
    const s = new JsonStream();
    s.on('error', () => {});
    const p = s.value('a');
    await feed(s, ['{"a": nope}']);
    await expect(p).rejects.toThrow(SyntaxError);
    expect(s.destroyed).toBe(true);
  });

  test('a syntax error destroys an attached readable', async () => {
    const s = new JsonStream();
    s.on('error', () => {});
    const r = s.stream('a');
    const err = new Promise(res => r.on('error', res));
    r.resume();
    await feed(s, ['{"a":"ok","b": nope}']);
    expect(await err).toBeInstanceOf(SyntaxError);
  });

  test('truncated input errors rather than hanging', async () => {
    const s = new JsonStream();
    const err = caught(s);
    await feed(s, ['{"a":[1,2']);
    expect(await err).toBeInstanceOf(SyntaxError);
  });
});

describe('object keys', () => {
  test.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'a key named %s parses as an own property', async (key) => {
      const s = new JsonStream();
      const seen: any[] = [];
      s.observe([key, 'y']).subscribe(v => seen.push(v.value));
      const p = s.value();
      await feed(s, [`{${JSON.stringify(key)}:{"y":1}}`]);
      const result: any = await p;
      expect(Object.hasOwn(result, key)).toBe(true);
      expect(result[key]).toEqual({ y: 1 });
      expect(seen).toEqual([1]);
    });

  test('__proto__ does not hijack the prototype or pollute globally', async () => {
    const s = new JsonStream();
    const p = s.value();
    await feed(s, ['{"__proto__":{"polluted":1},"a":2}']);
    const result: any = await p;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
    expect(result.a).toBe(2);
  });
});

describe('strings', () => {
  test('rejects a \\u escape that is not four hex digits', async () => {
    const s = new JsonStream();
    const err = caught(s);
    await feed(s, ['{"x":"\\u41"},"y":1}']);
    expect(await err).toBeInstanceOf(SyntaxError);
  });

  test('rejects an object key with no opening quote', async () => {
    const s = new JsonStream();
    const err = caught(s);
    await feed(s, ['{ab":1}']);
    expect(await err).toBeInstanceOf(SyntaxError);
  });

  test('a \\u escape split across chunks still decodes', async () => {
    const s = new JsonStream();
    const p = s.value();
    await feed(s, ['{"a":"\\u04', '14"}']);
    expect(await p).toEqual({ a: 'Д' });
  });
});

describe('collectJson', () => {
  test('exposes the raw text through json', async () => {
    const s = new JsonStream('', true);
    const p = s.value();
    await feed(s, ['{"a":', '1}']);
    await p;
    expect(s.json).toBe('{"a":1}');
  });

  test('json is empty when not collecting', async () => {
    const s = new JsonStream();
    const p = s.value();
    await feed(s, ['{"a":1}']);
    await p;
    expect(s.json).toBe('');
  });
});

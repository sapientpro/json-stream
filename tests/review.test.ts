/// <reference types="jest" />
import {finished} from 'node:stream/promises';
import {Any, JsonParser, Rest} from '../src/parser';
import {JsonStream} from '../src/node';
import {Subject} from '../src/subject';

const read = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
};

test('Node emits the completed root once, including trailing writes', async () => {
  for (const input of ['{}', '42 ', 'true ', '"hello"']) {
    const stream = new JsonStream();
    const values: unknown[] = [];
    stream.on('value', value => values.push(value));
    stream.write(Buffer.from(input));
    stream.write(' ');
    stream.end('suffix');
    await finished(stream);
    expect(values).toEqual([JSON.parse(input)]);
  }
});

test('wildcard string streams span multiple values and complete at document end', async () => {
  const parser = new JsonParser();
  const any = read(parser.stream(['items', Any, 'name']));
  const rest = read(parser.stream(['items', Rest]));
  const exact = read(parser.stream(['items', 0, 'name']));
  const text = '{"items":[{"name":"a\\uD83D\\uDE00"},{"name":"b","nested":["c"]}]}';
  for (const ch of text) parser.write(ch);
  parser.end();
  expect((await any).join('')).toBe('a😀b');
  expect((await rest).join('')).toBe('a😀bc');
  expect((await exact).join('')).toBe('a😀');
});

test('streaming a long string preserves its value, escapes and surrogate boundaries', () => {
  const parser = new JsonParser();
  const parts: string[] = [];
  parser.chunks('text').subscribe(value => parts.push(value));
  const expected = 'x'.repeat(1024 * 1024) + '😀\nend';
  const json = JSON.stringify({text: expected});
  for (let i = 0; i < json.length; i += 257) parser.write(json.slice(i, i + 257));
  parser.end();
  expect(parts.join('')).toBe(expected);
  expect(parser.root.text).toBe(expected);
});

test('observer callback failures do not interrupt parsing or other observers', async () => {
  const errors: unknown[] = [];
  const parser = new JsonParser({onObserverError: error => errors.push(error)});
  const failure = new Error('callback failed');
  parser.observe('a').subscribe(() => { throw failure; });
  const a = parser.value('a');
  const root = parser.value();
  parser.chunks('b').subscribe({
    next() { throw failure; },
    complete() { throw failure; },
  });
  parser.write('{"a":1,"b":"ok"}');
  parser.end();
  expect(await a).toBe(1);
  expect(await root).toEqual({a: 1, b: 'ok'});
  expect(errors).toEqual([failure, failure, failure]);
});

test('throwing error handlers do not mask the parse failure or strand promises', async () => {
  const errors: unknown[] = [];
  const parser = new JsonParser({onObserverError: error => errors.push(error)});
  const failure = new Error('handler failed');
  parser.observe('a').subscribe({error() { throw failure; }});
  const pending = parser.value('b');
  expect(() => parser.write('{bad}')).toThrow(SyntaxError);
  await expect(pending).rejects.toThrow(SyntaxError);
  expect(errors).toEqual([failure]);
});

test('default callback error reporting is deferred until after delivery', () => {
  const scheduled: (() => void)[] = [];
  const spy = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation(fn => { scheduled.push(fn); });
  try {
    const source = new Subject<number>();
    const failure = new Error('callback failed');
    const received: number[] = [];
    source.subscribe(() => { throw failure; });
    source.subscribe(value => received.push(value));
    source.next(1);
    expect(received).toEqual([1]);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toThrow(failure);
  } finally {
    spy.mockRestore();
  }
});

test('completion callbacks cannot strand other paths', async () => {
  const reported: unknown[] = [];
  const parser = new JsonParser({onObserverError: error => reported.push(error)});
  parser.observe('missing').subscribe({complete() { throw new Error('complete failed'); }});
  const pending = parser.value('alsoMissing');
  parser.write('{}');
  parser.end();
  await expect(pending).rejects.toThrow('without emitting');
  expect(reported).toHaveLength(1);
});

test('retainRoot false keeps observed subtrees complete but releases the root', () => {
  const parser = new JsonParser({retainRoot: false});
  const items: unknown[] = [];
  const paths: unknown[] = [];
  parser.observe(['items', Any]).subscribe(({value, path}) => { items.push(value); paths.push(path); });
  const text: string[] = [];
  parser.chunks('discard').subscribe(value => text.push(value));
  const input = '{"discard":"large string","items":[{"nested":[1,{"__proto__":2}]},{"nested":[3]}]}';
  for (const ch of input) parser.write(ch);
  parser.end();
  expect(items).toEqual(JSON.parse(input).items);
  expect(paths).toEqual([['items', 0], ['items', 1]]);
  expect(text.join('')).toBe('large string');
  expect(parser.root).toBeUndefined();
});

test('retainRoot false handles root observations and Rest', async () => {
  const parser = new JsonParser({retainRoot: false});
  const root = parser.value();
  const values: unknown[] = [];
  parser.observe([Rest]).subscribe(({value}) => values.push(value));
  parser.write('{"a":["hi",2]}');
  parser.end();
  expect(await root).toEqual({a: ['hi', 2]});
  expect(values).toEqual(['hi', 2, ['hi', 2]]);
  expect(parser.root).toBeUndefined();
});

test('retention mode rejects late value registration instead of returning partial trees', () => {
  const parser = new JsonParser({retainRoot: false});
  parser.write('{"a":');
  expect(() => parser.observe('a')).toThrow('before writing');
  parser.write('1}');
  parser.end();
});

test('Node accepts parser options without breaking the positional constructor', async () => {
  const stream = new JsonStream({retainRoot: false, maxDepth: 10});
  const value = stream.value('a');
  stream.end('{"a":{"b":1}}');
  await finished(stream);
  expect(await value).toEqual({b: 1});
  const legacy = new JsonStream('marker', true);
  legacy.end('marker{}');
  await finished(legacy);
  expect(legacy.json).toBe('marker{}');
});

test('bounded readable fails only the slow consumer and parsing continues', async () => {
  const parser = new JsonParser({maxBufferedChunks: 2});
  const reader = parser.stream('s').getReader();
  const seen: string[] = [];
  parser.chunks('s').subscribe(value => seen.push(value));
  parser.write('{"s":"');
  parser.write('a');
  parser.write('b');
  parser.write('c');
  parser.write('"}');
  parser.end();
  await expect(reader.read()).rejects.toThrow('maxBufferedChunks');
  expect(seen.join('')).toBe('abc');
  expect(parser.root).toEqual({s: 'abc'});
});

test('bounded readable permits an active consumer to keep draining', async () => {
  const parser = new JsonParser({maxBufferedChunks: 1});
  const reader = parser.stream('s').getReader();
  parser.write('{"s":"');
  for (const ch of 'abc') {
    const pending = reader.read();
    parser.write(ch);
    expect(await pending).toEqual({done: false, value: ch});
  }
  parser.write('"}');
  parser.end();
  expect((await reader.read()).done).toBe(true);
});

test('bounded async iterator rejects overflow without affecting other subscriptions', async () => {
  const parser = new JsonParser({maxBufferedChunks: 2});
  const source = parser.observe([Any]);
  const iterator = source[Symbol.asyncIterator]();
  const pending = iterator.next();
  const values: unknown[] = [];
  source.subscribe(({value}) => values.push(value));
  parser.write('[1,2,3,4]');
  parser.end();
  await expect(pending).rejects.toThrow('maxBufferedChunks');
  expect(values).toEqual([1, 2, 3, 4]);
});

test('async iterator survives compaction while its queue stays nonempty', async () => {
  const source = new Subject<number>({maxBufferedChunks: 3});
  const iterator = source[Symbol.asyncIterator]();
  const first = iterator.next();
  source.next(0);
  source.next(1);
  expect((await first).value).toBe(0);
  for (let i = 1; i <= 3000; i++) {
    source.next(i + 1);
    expect((await iterator.next()).value).toBe(i);
  }
  source.complete();
  expect((await iterator.next()).value).toBe(3001);
  expect((await iterator.next()).done).toBe(true);
  expect(source.observed).toBe(false);
});

test('async iterator preserves undefined values and falsy failures', async () => {
  const source = new Subject<undefined>();
  const iterator = source[Symbol.asyncIterator]();
  const first = iterator.next();
  source.next(undefined);
  expect(await first).toEqual({done: false, value: undefined});
  source.error(null);
  await expect(iterator.next()).rejects.toBeNull();
  const late = source[Symbol.asyncIterator]();
  await expect(late.next()).rejects.toBeNull();
});

test.each([0, -1, 1.5, NaN])('rejects invalid buffer limit %s', maxBufferedChunks => {
  expect(() => new JsonParser({maxBufferedChunks})).toThrow(RangeError);
});

test('Node passes Buffer input to the parser without copying', async () => {
  const spy = jest.spyOn(JsonParser.prototype, 'write');
  try {
    const buffer = Buffer.from('{"text":"hello"}');
    const stream = new JsonStream();
    stream.end(buffer);
    await finished(stream);
    expect(spy.mock.calls[0][0]).toBe(buffer);
  } finally {
    spy.mockRestore();
  }
});

test('cancelling a bounded readable leaves other subscribers active', async () => {
  const errors: unknown[] = [];
  const parser = new JsonParser({maxBufferedChunks: 1, onObserverError: error => errors.push(error)});
  const stream = parser.stream('s');
  const pieces: string[] = [];
  parser.chunks('s').subscribe(value => pieces.push(value));
  parser.write('{"s":"a');
  await stream.cancel();
  parser.write('b');
  parser.write('c"}');
  parser.end();
  expect(pieces.join('')).toBe('abc');
  expect(errors).toEqual([]);
});

test('returning from an async iterator unsubscribes it', async () => {
  const source = new Subject<number>();
  const iterator = source[Symbol.asyncIterator]();
  const pending = iterator.next();
  source.next(1);
  await pending;
  await iterator.return!();
  expect(source.observed).toBe(false);
});

test('pre-registered value sources retain complete containers before subscription', async () => {
  const parser = new JsonParser({retainRoot: false});
  const source = parser.observe('a');
  parser.write('{"a":{"first":1,');
  const values = read(source);
  parser.write('"last":2}}');
  parser.end();
  expect(await values).toEqual([{path: ['a'], value: {first: 1, last: 2}}]);
});

test.each([1, 3, 64, 10000])('selective retention matches JSON.parse across chunks of %s', async size => {
  const expected = {skip: ['discard'], data: [{text: '😀\n\u0000', empty: {}, list: [null, true, -1.5]}, 'tail']};
  const text = JSON.stringify(expected);
  const parser = new JsonParser({retainRoot: false});
  const selected = parser.value('data');
  for (let i = 0; i < text.length; i += size) parser.write(text.slice(i, i + size));
  parser.end();
  expect(await selected).toEqual(expected.data);
  expect(parser.root).toBeUndefined();
});

test('wildcard chunk streams propagate later parse errors after earlier strings', async () => {
  const parser = new JsonParser();
  const reader = parser.stream([Any]).getReader();
  parser.write('["ok",');
  expect((await reader.read()).value).toBe('ok');
  expect(() => parser.write('nope]')).toThrow(SyntaxError);
  await expect(reader.read()).rejects.toThrow(SyntaxError);
});

test('decoded fragments flush even when input ends inside an escape', () => {
  const parser = new JsonParser({retainRoot: false});
  const parts: string[] = [];
  parser.chunks('s').subscribe(value => parts.push(value));
  parser.write('{"s":"a\\');
  expect(parts.join('')).toBe('a');
  parser.write('nb\\u0');
  expect(parts.join('')).toBe('a\nb');
  parser.write('041"}');
  parser.end();
  expect(parts.join('')).toBe('a\nbA');
});

test('switches between ordinary strings and chunk streams without carrying fragments', () => {
  const parser = new JsonParser();
  parser.write('{"first":"ordinary","');
  const parts: string[] = [];
  parser.chunks('streamed').subscribe(part => parts.push(part));
  parser.write('streamed":"a\\uD83D');
  parser.write('\\uDE00b","last":"ordinary too"}');
  parser.end();
  expect(parts.join('')).toBe('a😀b');
  expect(parser.root).toEqual({first: 'ordinary', streamed: 'a😀b', last: 'ordinary too'});
});

test('unmatched and empty chunk paths preserve ordinary strings and keys', () => {
  const parser = new JsonParser();
  const empty: string[] = [];
  parser.chunks('missing').subscribe(() => { throw new Error('unexpected match'); });
  parser.chunks('empty').subscribe(part => empty.push(part));
  const input = '{"before":"x","empty":"","after":"y","escaped\\nkey":"z"}';
  for (const part of input) parser.write(part);
  parser.end();
  expect(parser.root).toEqual(JSON.parse(input));
  expect(empty).toEqual([]);
});

test.each([1, 31, 32, 33, 64, 1024])('string scanner preserves escapes around its fast-path boundary, chunks=%s', size => {
  const values = [0, 1, 30, 31, 32, 33, 63, 64, 65, 1024].flatMap(length => {
    const prefix = 'x'.repeat(length);
    return [prefix, prefix + '"end', prefix + '\\end', prefix + '\n😀end', prefix + '\uD800end'];
  });
  const expected = Object.fromEntries(values.map((value, i) => ['k'.repeat(i + 25) + i, value]));
  const input = JSON.stringify(expected);
  const parser = new JsonParser();
  const streamed: string[] = [];
  parser.chunks([Any]).subscribe(value => streamed.push(value));
  for (let i = 0; i < input.length; i += size) parser.write(input.slice(i, i + size));
  parser.end();
  expect(parser.root).toEqual(expected);
  expect(streamed.join('')).toBe(values.join(''));
});

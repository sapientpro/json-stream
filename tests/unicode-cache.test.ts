import {expect, test} from '@jest/globals';
import {Any, JsonParser} from '../src/parser';

const escapes = (units: number[]) => units.map(unit => '\\u' + unit.toString(16).padStart(4, '0')).join('');

test.each([1, 7, 1024])('Unicode cache collisions and recovery preserve values and fragments with %i-byte chunks', size => {
  const units = [
    ...Array.from({length: 32}, (_, i) => 0x100 + i * 64),
    ...Array.from({length: 600}, (_, i) => [0x0414, 0xD83D, 0xDE00][i % 3]!),
  ];
  const input = '{"\\u0414":"' + escapes(units) + '"}';
  const expected = JSON.parse(input), bytes = new TextEncoder().encode(input);
  for (const retainRoot of [true, false]) {
    const parser = new JsonParser({retainRoot}), pieces: string[] = [], values: unknown[] = [];
    parser.chunks([Any]).subscribe(piece => pieces.push(piece));
    parser.observe([Any]).subscribe(event => values.push(event.value));
    for (let pos = 0; pos < bytes.length; pos += size) parser.write(bytes.subarray(pos, pos + size));
    parser.end();
    expect(parser.root).toEqual(retainRoot ? expected : undefined);
    expect(values).toEqual([expected['Д']]);
    expect(pieces.join('')).toBe(expected['Д']);
  }
});

test('interleaved parsers preserve distinct Unicode units sharing the same cache slot', () => {
  const inputs = [[0x100, 0xD83D, 0xDE00], [0x140, 0xD83C, 0xDF0D]].map(units =>
    '{"text":"' + escapes(Array.from({length: 600}, (_, i) => units[i % units.length]!)) + '"}');
  const parsers = inputs.map(() => new JsonParser());
  const fragments: string[][] = [[], []];
  parsers.forEach((parser, i) => parser.chunks('text').subscribe(piece => fragments[i]!.push(piece)));
  for (let pos = 0; pos < Math.max(...inputs.map(input => input.length)); pos += 5) {
    parsers.forEach((parser, i) => parser.write(inputs[i]!.slice(pos, pos + 5)));
  }
  parsers.forEach((parser, i) => {
    parser.end();
    const expected = JSON.parse(inputs[i]!);
    expect(parser.root).toEqual(expected);
    expect(fragments[i]!.join('')).toBe(expected.text);
  });
});

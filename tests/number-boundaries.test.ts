/// <reference types="jest" />
import {Any, JsonParser} from '../src/parser';

const valid = [
  '0', '-0', '01', '-000', '12345678', '1000000000',
  '9007199254740993', '18446744073709551615',
  '0.01', '-0.00', '12345.6789', '1E+2', '-1.25e-3',
  '5e-324', '1e309', '1e-325', '1.7976931348623157e308',
];

test.each(valid)('number %s survives every byte boundary with synchronous observations', token => {
  const bytes = new TextEncoder().encode(`[${token},7]`);
  const expected = [Number(token), 7];
  for (const retainRoot of [true, false]) {
    for (let cut = 0; cut <= bytes.length; cut++) {
      const p = new JsonParser({retainRoot});
      const values: number[] = [];
      p.observe([Any]).subscribe(({value}) => values.push(value));
      p.write(bytes.subarray(0, cut));
      p.write(new Uint8Array());
      p.write(bytes.subarray(cut));
      // Results arrive synchronously, before end().
      expect(values).toEqual(expected);
      p.end();
      expect(p.root).toEqual(retainRoot ? expected : undefined);
    }
    const p = new JsonParser({retainRoot});
    const values: number[] = [];
    p.observe([Any]).subscribe(({value}) => values.push(value));
    for (const byte of bytes) p.write(Uint8Array.of(byte));
    p.end();
    expect(values).toEqual(expected);
    expect(p.root).toEqual(retainRoot ? expected : undefined);
  }
});

test.each(['-', '1.', '1e', '1E+', '1e-', '-0.1e+'])(
  'EOF rejects incomplete %s without emitting a value', token => {
    for (let cut = 0; cut <= token.length; cut++) {
      const p = new JsonParser();
      const values: unknown[] = [];
      p.observe().subscribe(({value}) => values.push(value));
      expect(() => { p.write(token.slice(0, cut)); p.write(token.slice(cut)); }).not.toThrow();
      expect(values).toEqual([]);
      expect(() => p.end()).toThrow(SyntaxError);
      expect(values).toEqual([]);
    }
  },
);

test.each(['1..2', '1.e2', '1e+-2', '1e--2', '1e2.3', '1e2e3', '1+2', '--1'])(
  'malformed numeric suffix %s fails at the terminator, across every cut', token => {
    for (let cut = 0; cut <= token.length; cut++) {
      const p = new JsonParser();
      const values: unknown[] = [];
      p.observe([Any]).subscribe(({value}) => values.push(value));
      expect(() => { p.write('[' + token.slice(0, cut)); p.write(token.slice(cut)); }).not.toThrow();
      expect(() => p.write(']')).toThrow(SyntaxError);
      expect(values).toEqual([]);
    }
  },
);

test('fragmented exponent does not emit until its terminator arrives', () => {
  const p = new JsonParser({retainRoot: false});
  const values: number[] = [];
  p.observe([Any]).subscribe(({value}) => values.push(value));
  for (const piece of ['[12', '.', '5', 'e', '-', '2']) {
    p.write(piece);
    expect(values).toEqual([]);
  }
  p.write(',');
  expect(values).toEqual([0.125]);
  p.write('-0]');
  expect(Object.is(values[1], -0)).toBe(true);
  p.end();
});

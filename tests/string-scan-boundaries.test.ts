import {expect, test} from '@jest/globals';
import {JsonParser} from '../src/parser';

// Place terminators on both sides of the manual-prefix/native-scan boundary.
test.each([0, 1, 30, 31, 32, 33, 63, 64])(
  'string scanning resumes around quotes and escapes after %i ordinary characters',
  length => {
    const value = 'a'.repeat(length) + '\n"\\😀' + 'b'.repeat(70);
    const input = JSON.stringify({value, tail: 42});
    const bytes = new TextEncoder().encode(input);
    for (let cut = 0; cut <= bytes.length; cut++) {
      const parser = new JsonParser();
      const pieces: string[] = [];
      parser.chunks(['value']).subscribe(piece => pieces.push(piece));
      parser.write(bytes.subarray(0, cut));
      parser.write(bytes.subarray(cut));
      parser.end();
      expect(parser.root).toEqual({value, tail: 42});
      expect(pieces.join('')).toBe(value);
      expect(parser.finished).toBe(true);
    }
  },
);

test.each([31, 32, 33])('an unterminated string after %i characters still fails at EOF', length => {
  const parser = new JsonParser({retainRoot: false});
  parser.write('"' + 'a'.repeat(length));
  expect(() => parser.end()).toThrow(SyntaxError);
});

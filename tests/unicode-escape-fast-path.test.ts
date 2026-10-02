import {expect, test} from '@jest/globals';
import {Any, JsonParser} from '../src/parser';

test.each(['0000', '0041', '00ff', 'FFFF', 'd800', 'dc00', 'D83D', 'DE00'])(
  'Unicode escape %s retains and streams the same value across every byte cut', hex => {
    const input = '{"\\u0041":"x\\u' + hex + '\\uD83D\\uDE00y","tail":42}';
    const expected = JSON.parse(input);
    const bytes = new TextEncoder().encode(input);
    for (let cut = 0; cut <= bytes.length; cut++) {
      const parser = new JsonParser();
      const pieces: string[] = [];
      parser.chunks(['A']).subscribe(piece => pieces.push(piece));
      parser.write(bytes.subarray(0, cut));
      parser.write(bytes.subarray(cut));
      parser.end();
      expect(parser.root).toEqual(expected);
      expect(pieces.join('')).toBe(expected.A);
      // A surrogate pair must remain in one fragment even at a chunk boundary.
      let offset = 0;
      for (const piece of pieces) {
        offset += piece.length;
        const left = expected.A.charCodeAt(offset - 1), right = expected.A.charCodeAt(offset);
        expect(left >= 0xD800 && left <= 0xDBFF && right >= 0xDC00 && right <= 0xDFFF).toBe(false);
      }
    }
  },
);

test.each(['g123', '1g23', '12g3', '123g'])(
  'invalid hex %s reports the same offset across every byte cut', hex => {
    const input = '"\\u' + hex + '"';
    for (let cut = 0; cut <= input.length; cut++) {
      const parser = new JsonParser({retainRoot: false});
      expect(() => {
        parser.write(input.slice(0, cut));
        parser.write(input.slice(cut));
        parser.end();
      }).toThrow('Json syntax error at 7');
    }
  },
);

test.each([0, 1, 2, 3])('incomplete Unicode escape with %i hex digits fails at EOF', count => {
  const parser = new JsonParser();
  parser.write('"\\u' + '1234'.slice(0, count));
  expect(() => parser.end()).toThrow(SyntaxError);
});

test('Unicode escapes remain validated in discarded branches and decoded in selected values', () => {
  const parser = new JsonParser({retainRoot: false});
  const values: unknown[] = [];
  parser.observe(['items', Any, 'wanted']).subscribe(event => values.push(event.value));
  parser.write('{"items":[{"skip":"\\uFFFF","wanted":"\\u0041"},{"wanted":"\\uD83D\\uDE00"}]}');
  parser.end();
  expect(parser.root).toBeUndefined();
  expect(values).toEqual(['A', '😀']);
  const invalid = new JsonParser({retainRoot: false});
  expect(() => invalid.write('{"skip":"\\u12g4"}')).toThrow(SyntaxError);
});

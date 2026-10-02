import {expect, test} from '@jest/globals';
import {Any, JsonParser} from '../src/parser';

test.each(['true', 'false', 'null'])('root literal %s waits for a terminator or end', word => {
  const expected = JSON.parse(word);
  for (let cut = 0; cut <= word.length; cut++) {
    const parser = new JsonParser();
    const values: unknown[] = [];
    parser.observe([]).subscribe(event => values.push(event.value));
    parser.write(word.slice(0, cut));
    parser.write(word.slice(cut));
    expect(parser.finished).toBe(false);
    expect(values).toEqual([]);
    parser.end();
    expect(parser.root).toBe(expected);
    expect(values).toEqual([expected]);
  }
  const terminated = new JsonParser();
  terminated.write(word);
  expect(terminated.finished).toBe(false);
  terminated.write(' ');
  expect(terminated.finished).toBe(true);
  expect(terminated.root).toBe(expected);
});

test.each([true, false])('literal arrays retain=%s preserve every byte cut and selected events', retainRoot => {
  const text = '[true,false,null,true, false, null]';
  const expected = JSON.parse(text);
  const bytes = new TextEncoder().encode(text);
  for (let cut = 0; cut <= bytes.length; cut++) {
    const parser = new JsonParser({retainRoot});
    const values: unknown[] = [];
    parser.observe([Any]).subscribe(event => values.push(event.value));
    parser.write(bytes.subarray(0, cut));
    parser.write(bytes.subarray(cut));
    parser.end();
    expect(parser.root).toEqual(retainRoot ? expected : undefined);
    expect(values).toEqual(expected);
  }
});

test.each(['truex', 'falsehood', 'nullable', 'tru', 'fals', 'nul'])(
  'invalid literal %s stays invalid across all splits', word => {
    const text = '[' + word + ']';
    for (let cut = 0; cut <= text.length; cut++) {
      const parser = new JsonParser();
      expect(() => {
        parser.write(text.slice(0, cut));
        parser.write(text.slice(cut));
        parser.end();
      }).toThrow(SyntaxError);
    }
  },
);

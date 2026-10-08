import {expect, test} from '@jest/globals';
import {JsonParser, Json5Parser} from '../src/v3/index';

test.each(['text', 'bytes'])('scanner cleanup preserves an active parser during %s callbacks', input => {
    const outer = new JsonParser(), values: unknown[] = [];
    const text = JSON.stringify(['first'.repeat(20), 'π😀'.repeat(30), 'last'.repeat(20)]);
    outer.onValue('$[*]', (value, path) => {
        values.push([value, path]);
        for (const Parser of [JsonParser, Json5Parser]) {
            for (const lifecycle of ['end', 'reset', 'destroy', 'error'] as const) {
                const inner = new Parser();
                inner.write(JSON.stringify({text: 'other'.repeat(100)}));
                if (lifecycle === 'error') expect(() => inner.write('!')).toThrow(SyntaxError);
                else inner[lifecycle]();
                if (lifecycle === 'reset') {
                    inner.write('null');
                    inner.end();
                    expect(inner.finished).toBe(true);
                }
            }
        }
    });
    outer.write(input === 'bytes' ? new TextEncoder().encode(text) : text);
    outer.end();
    expect(values).toEqual(JSON.parse(text).map((value: string, index: number) => [value, [index]]));
});

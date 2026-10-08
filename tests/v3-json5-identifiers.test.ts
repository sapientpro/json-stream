import { decodedInput } from './v3-input';
import {describe, expect, test} from '@jest/globals';
import JSON5 from 'json5';
import {Json5Parser} from '../src/v3/index';

describe('JSON5 identifier reuse', () => {
    test('another parser can finish, fail or cancel inside a value callback', () => {
        const parser = new Json5Parser(), paths: unknown[] = [];
        let root: unknown;
        parser.onValue('$', value => root = value);
        parser.onValue('$[*].id', (value, path) => {
            paths.push(path);
            const inner = new Json5Parser();
            if (value === 2) {
                expect(() => inner.write('{id-:9}')).toThrow(SyntaxError);
            } else {
                inner.write('{id:9}');
                if (value === 1) inner.destroy();
                else inner.end();
            }
        });
        parser.write('[{id:1},{id:2},{id:3}]');
        parser.end();
        expect(root).toEqual([{id:1}, {id:2}, {id:3}]);
        expect(paths).toEqual([[0, 'id'], [1, 'id'], [2, 'id']]);
    });
    test('plain, escaped and Unicode names preserve values and paths at every UTF-8 cut', () => {
        const input = '[{id:1,a\\u0062:2,π:3,_x:4,$x:5,__proto__:6},{id:7,a\\u0062:8,π:9}]';
        const bytes = new TextEncoder().encode(input);
        for (let cut = 0; cut <= bytes.length; cut++) {
            const parser = new Json5Parser(), events: unknown[] = [];
            let root: unknown;
            parser.onValue('$', value => root = value);
            parser.onValue('$[*].*', (value, path) => events.push([value, path]));
            decodedInput(parser).write(bytes.subarray(0, cut));
            decodedInput(parser).write(bytes.subarray(cut));
            decodedInput(parser).end();
            expect(root).toEqual(JSON5.parse(input));
            expect(events).toEqual([[1, [0, 'id']], [2, [0, 'ab']], [3, [0, 'π']],
                [4, [0, '_x']], [5, [0, '$x']], [6, [0, '__proto__']],
                [7, [1, 'id']], [8, [1, 'ab']], [9, [1, 'π']]]);
        }
    });
    test('cached prefixes never conceal invalid identifier continuations', () => {
        for (const name of ['id-', String.raw`id\u00z0`, '0id', String.raw`\u0030id`, String.raw`id\uD800`]) {
            const input = '[{id:1},{' + name + ':2}]';
            for (let cut = 0; cut <= input.length; cut++) {
                const parser = new Json5Parser();
                parser.onValue('$', () => {});
                expect(() => { parser.write(input.slice(0, cut)); parser.write(input.slice(cut)); parser.end(); }).toThrow(SyntaxError);
            }
        }
    });
    test('colliding, unique and long names remain correct across parsers and reset', () => {
        const input = '[{' + Array.from({length:600}, (_, i) => 'key' + i + ':' + i).join(',')
            + ',' + 'long'.repeat(40) + ':601}]';
        const expected = JSON5.parse(input);
        for (let repeat = 0; repeat < 2; repeat++) {
            const parser = new Json5Parser(); let root: unknown;
            parser.onValue('$', value => root = value);
            parser.write(input);
            expect(root).toEqual(expected);
            parser.reset();
            parser.write(String.raw`[{id:1,i\u0064:2,identity:3,constructor:4,__proto__:5}]`); parser.end();
            expect(root).toEqual(JSON5.parse(String.raw`[{id:1,i\u0064:2,identity:3,constructor:4,__proto__:5}]`));
        }
    });
});

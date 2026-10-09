import { decodedInput } from './input';
import {expect, test} from '@jest/globals';
import {JsonParser, Json5Parser, Any, Rest} from '../src/index';

test.each([JsonParser, Json5Parser])('%p restores concrete paths after unused nested branches', Parser => {
    const value = {skip: [{a: [{b: [1, 2, {s: '😀'}]}]}, []], items: [
        {skip: {deep: [[null], {x: 1}]}, id: 0, text: 'π😀'},
        {skip: [[1, 2], [], {a: [3]}], id: 1, text: 'next'},
    ], tail: {id: 2}};
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    for (const size of [1, 2, 7, 64, 65536]) {
        const p = new Parser(), ids: unknown[] = [], parts: [string, readonly (string | number)[]][] = [];
        p.onValue('$.items[*].id', (v, path) => ids.push([v, path]));
        p.onValue('$.tail.id', (v, path) => ids.push([v, path]));
        p.onString('$.items[*].text', (v, path) => parts.push([v, path]));
        for (let i = 0; i < bytes.length; i += size) decodedInput(p).write(bytes.subarray(i, i + size));
        p.reset(); decodedInput(p).write(new TextEncoder().encode('{"skip":[[1],[2]],"tail":{"id":3}}')); decodedInput(p).end();
        expect(ids).toEqual([[0, ['items', 0, 'id']], [1, ['items', 1, 'id']], [2, ['tail', 'id']], [3, ['tail', 'id']]]);
        for (let i = 0; i < 2; i++) expect(parts.filter(([, path]) => (path as unknown[])[1] === i).map(([v]) => v).join('')).toBe(value.items[i].text);
    }
});

test('unused arrays still reject trailing commas and incomplete values', () => {
    for (const doc of ['{"skip":[1,],"id":2}', '{"skip":[[1,]],"id":2}', '{"skip":[1,,2]}', '{"skip":[1,']) {
        const p = new JsonParser(); p.onValue('$.id', () => {});
        expect(() => {p.write(doc); p.end();}).toThrow(SyntaxError);
    }
});

test.each([JsonParser, Json5Parser])('%p preserves retained branches and recursive wildcard paths', Parser => {
    const root = {skip: [{nested: [1, {id: 2}]}], items: [{id: 3}]};
    const p = new Parser(), all: unknown[] = [], selected: unknown[] = [];
    p.onValue('$', v => all.push(v));
    p.onValue(['items', Any], (v, path) => selected.push([v, path]));
    p.write(JSON.stringify(root)); p.end();
    expect(all).toEqual([root]); expect(selected).toEqual([[{id: 3}, ['items', 0]]]);
    const q = new Parser(), paths: unknown[] = [];
    q.onValue([Rest], (v, path) => {if (path.at(-1) === 'id') paths.push([v, path]);});
    q.write(JSON.stringify(root)); q.end();
    expect(paths).toEqual([[2, ['skip', 0, 'nested', 1, 'id']], [3, ['items', 0, 'id']]]);
});

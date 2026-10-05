import {captureRoot, capturedRoot} from './v3-capture';
import {describe, expect, test} from '@jest/globals';
import {JsonParser, Json5Parser} from '../src/v3/index';
const encoder = new TextEncoder();
const prefix = '{"meta":{"id":1},"text":"';
const value = 'Пояснення 😀.\nКод: "value"; шлях C:\\tmp.\n'.repeat(20);
const input = prefix + JSON.stringify(value).slice(1) + '}';

describe.each([JsonParser, Json5Parser])('%s LLM string delivery', Parser => {
    test.each([1, 2, 3, 7, 32, 128, 1024])('byte chunks of %i deliver the first complete character immediately', size => {
        const parser = new Parser({});
        let writing = false, writes = 0, firstWrite = 0, text = '';
        parser.onString(['text'], (part, path) => {
            expect(writing).toBe(true);
            expect(path).toEqual(['text']);
            if (!firstWrite) firstWrite = writes;
            text += part;
        });
        const bytes = encoder.encode(input);
        for (let at = 0; at < bytes.length; at += size) {
            ++writes; writing = true;
            parser.write(bytes.subarray(at, at + size));
            writing = false;
        }
        parser.end();
        expect(firstWrite).toBe(Math.ceil((encoder.encode(prefix).length + encoder.encode('П').length) / size));
        expect(text).toBe(value);
        expect(capturedRoot(parser)).toBeUndefined();
    });
    test('text chunks preserve surrogate pairs and do not wait for the string to close', () => {
        const parser = new Parser({});
        const parts: string[] = [];
        parser.onString(['text'], part => parts.push(part));
        parser.write(prefix + 'П');
        expect(parts.join('')).toBe('П');
        expect(parser.rootReady).toBe(false);
        parser.write('\ud83d');
        expect(parts.join('')).toBe('П');
        parser.write('\ude00');
        expect(parts.join('')).toBe('П😀');
        parser.write('"}'); parser.end();
        expect(parts.join('')).toBe('П😀');
    });
});

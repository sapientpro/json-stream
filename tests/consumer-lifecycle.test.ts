import {describe, expect, jest, test} from '@jest/globals';
import {JsonParser, Json5Parser} from '../src/index';

// Public guarantees carried forward from the removed 2.x regression suite.
describe.each([JsonParser, Json5Parser])('consumer lifecycle', Parser => {
    test('default callback errors are deferred until after other consumers receive the value', () => {
        const scheduled: (() => void)[] = [];
        const spy = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation(fn => {scheduled.push(fn);});
        try {
            const parser = new Parser(); const failure = new Error('consumer failed'); const values: number[] = [];
            parser.onValue('$', () => {throw failure;});
            parser.onValue<number>('$', value => values.push(value));
            parser.end('42');
            expect(values).toEqual([42]); expect(parser.finished).toBe(true);
            expect(scheduled).toHaveLength(1); expect(scheduled[0]).toThrow(failure);
        } finally {spy.mockRestore();}
    });
    test('throwing error handlers preserve the parse failure for first-value promises', async () => {
        const reported: unknown[] = []; const parser = new Parser({onObserverError: error => reported.push(error)});
        const failure = new Error('error handler failed');
        const observer = {failed: false, next() {}, error(error: unknown) {this.failed = error instanceof SyntaxError; throw failure;}};
        parser.onValue('$.a', observer);
        const pending = expect(parser.getValue('$.b')).rejects.toThrow(SyntaxError);
        expect(() => parser.end('{bad}')).toThrow(SyntaxError);
        await pending; expect(observer.failed).toBe(true); expect(reported).toEqual([failure]);
    });
    test('throwing completion handlers cannot strand missing-value promises', async () => {
        const reported: unknown[] = []; const parser = new Parser({onObserverError: error => reported.push(error)});
        const failure = new Error('completion failed');
        parser.onValue('$.missing', {next() {}, complete() {throw failure;}});
        const pending = expect(parser.getValue('$.absent')).rejects.toThrow('No value matched');
        parser.end('{}'); await pending;
        expect(parser.finished).toBe(true); expect(reported).toEqual([failure]);
    });
    test('unsubscribing during delivery skips that consumer and leaves others active', () => {
        const parser = new Parser(); const first: number[] = []; const skipped: number[] = []; const last: number[] = [];
        const firstSub = parser.onValue<number>('$[*]', value => {first.push(value); skippedSub.unsubscribe(); firstSub.unsubscribe();});
        const skippedSub = parser.onValue<number>('$[*]', value => skipped.push(value));
        parser.onValue<number>('$[*]', value => last.push(value));
        parser.end('[1,2]');
        expect(first).toEqual([1]); expect(skipped).toEqual([]); expect(last).toEqual([1,2]);
    });
    test('interleaved parsers keep independent Unicode values and streamed fragments', () => {
        const units = [[0x100, 0xD83D, 0xDE00], [0x140, 0xD83C, 0xDF0D]];
        const inputs = units.map(set => '{"text":"' + Array.from({length: 600}, (_, i) => '\\u' + set[i % set.length]!.toString(16).padStart(4, '0')).join('') + '"}');
        const parsers = inputs.map(() => new Parser()); const fragments = ['', '']; const roots: any[] = [];
        parsers.forEach((parser, i) => {parser.onString('$.text', piece => {fragments[i] += piece;}); parser.onValue('$', value => {roots[i] = value;});});
        for (let pos = 0; pos < Math.max(...inputs.map(input => input.length)); pos += 5)
            parsers.forEach((parser, i) => parser.write(inputs[i]!.slice(pos, pos + 5)));
        parsers.forEach((parser, i) => {parser.end(); const expected = JSON.parse(inputs[i]!); expect(roots[i]).toEqual(expected); expect(fragments[i]).toBe(expected.text);});
    });
});

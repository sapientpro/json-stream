import {describe, expect, test} from '@jest/globals';
import {finished} from 'node:stream/promises';
import {createParser, JsonParser, Json5Parser, JsonLinesParser, PrefixedJsonParser} from '../src/v3';
import type {FormatOptions} from '../src/v3';
const createCompactParser = (options: FormatOptions = {}) => createParser({...options, memoryMode: 'compact'});
import {createNodeWritable} from '../src/v3/node';
import {decodedInput} from './v3-input';
import type {Format} from '../src/v3/types';

for (const format of ['json','json5'] as const) describe('copying ' + format, () => {
    test('values, paths, Unicode and observers survive large writes and reset', () => {
        for (const bytes of [false,true]) for (const length of [1,12,128,129]) {
            const value = ('π😀\\\n\ud800').repeat(40).slice(0,length);
            const parser = createCompactParser({format}), selected: unknown[] = [];
            const observer = {
                text:'', ends:0, completions:0,
                next(value: string) {this.text += value;},
                end() {this.ends++;}, complete() {this.completions++;},
            };
            parser.onString('$.value', observer);
            parser.onValue('$.value', (value,path) => selected.push([value,path]));
            const text = JSON.stringify({skip:'x'.repeat(70000),value});
            const input = bytes ? new TextEncoder().encode(text) : text;
            const transport = decodedInput(parser);
            transport.write(input.slice(0,input.length-3)); transport.write(input.slice(input.length-3));
            parser.reset(); transport.write(bytes ? new TextEncoder().encode('{"value":"again"}') : '{"value":"again"}'); transport.end();
            expect(selected).toEqual([[value,['value']],['again',['value']]]);
            expect(observer.text).toBe(value+'again'); expect(observer.ends).toBe(2); expect(observer.completions).toBe(1);
        }
    });
    test('getValue resolves the first scalar and rejects absence or invalid input', async () => {
        const parser = createCompactParser({format}), result = parser.getValue<string>('$.value');
        parser.write(JSON.stringify({skip:'x'.repeat(70000),value:'π😀'})); parser.end();
        await expect(result).resolves.toBe('π😀');
        const absent = createCompactParser({format}), missing = absent.getValue('$.missing');
        absent.write('{}'); absent.end(); await expect(missing).rejects.toThrow('No value matched');
        const invalid = createCompactParser({format}), failure = invalid.getValue();
        expect(() => {invalid.write('{'); invalid.end();}).toThrow(SyntaxError);
        await expect(failure).rejects.toBeInstanceOf(SyntaxError);
    });
    test('unsubscribe in next preserves other consumers and suppresses end/complete', () => {
        const parser = createCompactParser({format}); const events: string[] = [], values: string[] = [];
        const subscription = parser.onString('$.value', {
            next(value) {events.push(value); subscription.unsubscribe();},
            end() {events.push('end');}, complete() {events.push('complete');},
        });
        parser.onValue<string>('$.value', value => values.push(value));
        parser.write('{"skip":"'+'x'.repeat(70000)+'","value":"first'); parser.write('second"}'); parser.end();
        expect(events).toEqual(['first']); expect(values).toEqual(['firstsecond']);
    });
    test('callback exceptions are isolated and object error receivers are preserved', () => {
        const reported: unknown[] = [], parser = createCompactParser({format,onObserverError:e=>reported.push(e)});
        const boom = new Error('consumer'); let text = '';
        parser.onString('$.value', () => {throw boom;}); parser.onString('$.value', value => text+=value);
        parser.write('{"value":"a"}'); parser.end(); expect(reported).toEqual([boom]); expect(text).toBe('a');
        const invalid = createCompactParser({format});
        const observer = {failed:false, next() {}, error(error: unknown) {this.failed=error instanceof SyntaxError;}};
        invalid.onString('$.value',observer);
        expect(() => {invalid.write('{"value":"'); invalid.end();}).toThrow(SyntaxError); expect(observer.failed).toBe(true);
    });
    test('string stream honors overflow and cancellation', async () => {
        const parser = createCompactParser({format,maxBufferedChunks:1});
        const stream = parser.stringStream('$.value'), value = parser.getValue('$.value');
        parser.write('{"value":"a'); parser.write('b"}'); parser.end();
        await expect(stream.getReader().read()).rejects.toBeInstanceOf(RangeError); await expect(value).resolves.toBe('ab');
        const cancelled = createCompactParser({format}), unread = cancelled.stringStream('$.value');
        const result = cancelled.getValue('$.value'); await unread.cancel();
        cancelled.write('{"value":"next"}'); cancelled.end(); await expect(result).resolves.toBe('next');
    });
    test('Web writable identity, strings, collection and Node transport work', async () => {
        const parser = createCompactParser({format,collectJson:true});
        expect(parser.writable).toBe(parser.writable);
        const stream = parser.stringStream('$.value'), reader = stream.getReader(), pending = reader.read();
        const writer = parser.writable.getWriter(); await writer.write('{"value":"π😀"}'); await writer.close();
        await expect(pending).resolves.toEqual({done:false,value:'π😀'}); await expect(reader.read()).resolves.toEqual({done:true,value:undefined});
        expect(parser.json).toBe('{"value":"π😀"}'); expect(parser.closed).toBe(true); expect(parser.finished).toBe(true);
        const nodeParser = createCompactParser({format}), value = nodeParser.getValue('$.value'), sink = createNodeWritable(nodeParser);
        sink.end('{"value":"node"}'); await finished(sink); await expect(value).resolves.toBe('node');
    });
    test('Web abort and destroy terminate consumers', async () => {
        const parser = createCompactParser({format}), value = parser.getValue();
        const failure = new Error('abort'); await parser.writable.abort(failure);
        await expect(value).rejects.toBe(failure); expect(parser.closed).toBe(true);
        const other = createCompactParser({format}); let complete = 0;
        other.onString('$', {next() {}, complete() {complete++;}}); other.destroy(); expect(complete).toBe(1);
    });
    test('objects retain their original shared identity', () => {
        const parser = createCompactParser({format}); let root: any, child: any;
        parser.onValue('$', value => root=value); parser.onValue('$.child',value=>child=value);
        parser.write(JSON.stringify({skip:'x'.repeat(70000),child:{value:'short'}}));
        parser.end(); expect(root.child).toBe(child); expect(child.value).toBe('short');
    });
});

test('copying options and base validation reject invalid inputs', () => {
    for (const memoryMode of ['invalid', null, 0, false]) {
        for (const Parser of [JsonParser, Json5Parser, JsonLinesParser])
            expect(() => new Parser({memoryMode} as any)).toThrow(TypeError);
    }
    expect(() => new PrefixedJsonParser('@', {memoryMode: null} as any)).toThrow(TypeError);
    expect(()=>createCompactParser({format:'invalid' as Format})).toThrow(TypeError);
    expect(()=>createCompactParser({maxBufferedChunks:0})).toThrow(RangeError);
    const parser=createCompactParser();
    expect(()=>parser.onString('$',null as any)).toThrow(TypeError);
    expect(()=>parser.onValue('$',{} as any)).toThrow(TypeError);
    parser.write('{}'); parser.end(); expect(()=>parser.onString('$',()=>{})).toThrow();
});

test('copying core accepts text and leaves byte decoding to wrappers', () => {
    const parser = createCompactParser();
    // @ts-expect-error core accepts strings only
    expect(() => parser.write(new Uint8Array([123,125]))).toThrow(TypeError);
});

for (const format of ['json', 'json5'] as const) for (const bytes of [false, true]) {
    test(`compact mode in JSONL/prefix managers: ${format}, bytes=${bytes}`, () => {
        const doc = JSON.stringify({skip: 'x'.repeat(70000), label: 'π😀\ud800'});
        for (const prefix of [false, true]) {
            const options = {format, memoryMode: 'compact' as const};
            const manager = prefix ? new PrefixedJsonParser('@', options) : new JsonLinesParser(options);
            const values: unknown[] = [], fragments: unknown[] = [];
            manager.onValue('$.label', (v, path, i) => values.push([v, path, i]));
            manager.onString('$.label', (v, path, i) => fragments.push([v, path, i]));
            const input = prefix ? '@' + doc + 'junk@' + doc : doc + '\n' + doc + '\n';
            manager.write(bytes ? new TextEncoder().encode(input) : input); manager.end();
            const expected = [['π😀\ud800', ['label'], 0], ['π😀\ud800', ['label'], 1]];
            expect(values).toEqual(expected); expect(fragments).toEqual(expected);
        }
    });
}

test('compact policy activates at the input threshold and clears at reset', () => {
    const parser = new JsonParser({memoryMode:'compact'});
    const policy = (parser as any)._copyPolicy;
    parser.onString('$', () => {});
    parser.write('"' + 'x'.repeat(65534)); // 65535 UTF-16 units
    expect(policy.large).toBe(false);
    parser.write('"'); parser.reset();
    parser.write('"' + 'x'.repeat(65535)); // 65536 UTF-16 units
    expect(policy.large).toBe(true);
    parser.write('"'); parser.reset(); expect(policy.large).toBe(false);
    parser.write('"small"'); parser.end(); expect(policy.large).toBe(false);
    const normal = new JsonParser();
    expect(Object.hasOwn(normal, 'write')).toBe(false);
    expect(Object.hasOwn(normal, '_copyPolicy')).toBe(false);
});

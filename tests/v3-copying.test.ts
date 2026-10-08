import {describe, expect, test} from '@jest/globals';
import {finished} from 'node:stream/promises';
import {createCopyingParser} from '../src/v3/copying';
import {createNodeWritable} from '../src/v3/node';
import {decodedInput} from './v3-input';
import type {Format} from '../src/v3/types';

for (const format of ['json','json5'] as const) describe('copying ' + format, () => {
    test('values, paths, Unicode and observers survive large writes and reset', () => {
        for (const bytes of [false,true]) for (const length of [1,12,128,129]) {
            const value = ('π😀\\\n\ud800').repeat(40).slice(0,length);
            const parser = createCopyingParser({format}), selected: unknown[] = [];
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
        const parser = createCopyingParser({format}), result = parser.getValue<string>('$.value');
        parser.write(JSON.stringify({skip:'x'.repeat(70000),value:'π😀'})); parser.end();
        await expect(result).resolves.toBe('π😀');
        const absent = createCopyingParser({format}), missing = absent.getValue('$.missing');
        absent.write('{}'); absent.end(); await expect(missing).rejects.toThrow('No value matched');
        const invalid = createCopyingParser({format}), failure = invalid.getValue();
        expect(() => {invalid.write('{'); invalid.end();}).toThrow(SyntaxError);
        await expect(failure).rejects.toBeInstanceOf(SyntaxError);
    });
    test('unsubscribe in next preserves other consumers and suppresses end/complete', () => {
        const parser = createCopyingParser({format}); const events: string[] = [], values: string[] = [];
        const subscription = parser.onString('$.value', {
            next(value) {events.push(value); subscription.unsubscribe();},
            end() {events.push('end');}, complete() {events.push('complete');},
        });
        parser.onValue<string>('$.value', value => values.push(value));
        parser.write('{"skip":"'+'x'.repeat(70000)+'","value":"first'); parser.write('second"}'); parser.end();
        expect(events).toEqual(['first']); expect(values).toEqual(['firstsecond']);
    });
    test('callback exceptions are isolated and object error receivers are preserved', () => {
        const reported: unknown[] = [], parser = createCopyingParser({format,onObserverError:e=>reported.push(e)});
        const boom = new Error('consumer'); let text = '';
        parser.onString('$.value', () => {throw boom;}); parser.onString('$.value', value => text+=value);
        parser.write('{"value":"a"}'); parser.end(); expect(reported).toEqual([boom]); expect(text).toBe('a');
        const invalid = createCopyingParser({format});
        const observer = {failed:false, next() {}, error(error: unknown) {this.failed=error instanceof SyntaxError;}};
        invalid.onString('$.value',observer);
        expect(() => {invalid.write('{"value":"'); invalid.end();}).toThrow(SyntaxError); expect(observer.failed).toBe(true);
    });
    test('string stream honors overflow and cancellation', async () => {
        const parser = createCopyingParser({format,maxBufferedChunks:1});
        const stream = parser.stringStream('$.value'), value = parser.getValue('$.value');
        parser.write('{"value":"a'); parser.write('b"}'); parser.end();
        await expect(stream.getReader().read()).rejects.toBeInstanceOf(RangeError); await expect(value).resolves.toBe('ab');
        const cancelled = createCopyingParser({format}), unread = cancelled.stringStream('$.value');
        const result = cancelled.getValue('$.value'); await unread.cancel();
        cancelled.write('{"value":"next"}'); cancelled.end(); await expect(result).resolves.toBe('next');
    });
    test('Web writable identity, strings, collection and Node transport work', async () => {
        const parser = createCopyingParser({format,collectJson:true,minInputLength:1});
        expect(parser.writable).toBe(parser.writable);
        const stream = parser.stringStream('$.value'), reader = stream.getReader(), pending = reader.read();
        const writer = parser.writable.getWriter(); await writer.write('{"value":"π😀"}'); await writer.close();
        await expect(pending).resolves.toEqual({done:false,value:'π😀'}); await expect(reader.read()).resolves.toEqual({done:true,value:undefined});
        expect(parser.json).toBe('{"value":"π😀"}'); expect(parser.closed).toBe(true); expect(parser.finished).toBe(true);
        const nodeParser = createCopyingParser({format}), value = nodeParser.getValue('$.value'), sink = createNodeWritable(nodeParser);
        sink.end('{"value":"node"}'); await finished(sink); await expect(value).resolves.toBe('node');
    });
    test('Web abort and destroy terminate consumers', async () => {
        const parser = createCopyingParser({format}), value = parser.getValue();
        const failure = new Error('abort'); await parser.writable.abort(failure);
        await expect(value).rejects.toBe(failure); expect(parser.closed).toBe(true);
        const other = createCopyingParser({format}); let complete = 0;
        other.onString('$', {next() {}, complete() {complete++;}}); other.destroy(); expect(complete).toBe(1);
    });
    test('objects retain their original shared identity', () => {
        const parser = createCopyingParser({format,minInputLength:1}); let root: any, child: any;
        parser.onValue('$', value => root=value); parser.onValue('$.child',value=>child=value);
        parser.write('{"child":{"value":"short"}}'); parser.end(); expect(root.child).toBe(child);
    });
});

test('copying options and base validation reject invalid inputs', () => {
    for (const option of ['maxCopyLength','minInputLength']) for (const value of [0,-1,1.5,NaN,Infinity]) {
        expect(()=>createCopyingParser({[option]:value})).toThrow(RangeError);
    }
    expect(()=>createCopyingParser({format:'invalid' as Format})).toThrow(TypeError);
    expect(()=>createCopyingParser({maxBufferedChunks:0})).toThrow(RangeError);
    const parser=createCopyingParser();
    expect(()=>parser.onString('$',null as any)).toThrow(TypeError);
    expect(()=>parser.onValue('$',{} as any)).toThrow(TypeError);
    parser.write('{}'); parser.end(); expect(()=>parser.onString('$',()=>{})).toThrow();
});

test('copying core accepts text and leaves byte decoding to wrappers', () => {
    const parser = createCopyingParser();
    // @ts-expect-error core accepts strings only
    expect(() => parser.write(new Uint8Array([123,125]))).toThrow(TypeError);
});

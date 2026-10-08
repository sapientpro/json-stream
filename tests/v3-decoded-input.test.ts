import {test, expect} from '@jest/globals';
import {JsonParser, Json5Parser, createDecodedInput, JsonLinesParser} from '../src/v3';
import {createNodeWritable} from '../src/v3/node';
import {finished} from 'node:stream/promises';

for (const Parser of [JsonParser, Json5Parser]) {
    test(Parser.name + ' accepts text only, transports decode every UTF-8 cut', async () => {
        const direct = new Parser();
        expect(() => direct.write(new Uint8Array() as unknown as string)).toThrow(TypeError);
        direct.write('null'); direct.end();
        const text = JSON.stringify({text:'П😀漢字'}), bytes = new TextEncoder().encode(text);
        for (let cut = 0; cut <= bytes.length; ++cut) {
            const parser = new Parser({collectJson:true}); let value: unknown;
            parser.onValue('$', v => value = v);
            const input = createDecodedInput(parser);
            input.write(bytes.subarray(0,cut)); input.write(bytes.subarray(cut)); input.end();
            expect(value).toEqual({text:'П😀漢字'}); expect(parser.json).toBe(text);
        }
        const parser = new Parser(); let value: unknown;
        parser.onValue('$', v => value = v);
        const sink = createNodeWritable(parser);
        for (const byte of bytes) sink.write(Buffer.from([byte]));
        sink.end(); await finished(sink); expect(value).toEqual({text:'П😀漢字'});
    });
}
test('transport flushes incomplete UTF-8 at EOF instead of dropping it', () => {
    for (const bytes of [Uint8Array.of(34,0xe2,0x82), Uint8Array.of(123,125,0xe2,0x82)]) {
        const parser = new JsonParser({collectJson:true}); const input = createDecodedInput(parser);
        input.write(bytes);
        expect(() => input.end()).toThrow(SyntaxError);
        expect(parser.closed).toBe(true);
        expect(parser.json).toContain('�');
    }
});
test('transport reentry cannot corrupt the decoder; reset keeps decoder on the transport', () => {
    const errors: unknown[] = [], values: unknown[] = [];
    const parser = new JsonParser({onObserverError:e=>errors.push(e)}), input = createDecodedInput(parser);
    parser.onValue('$', v => {values.push(v); input.write(Uint8Array.of(32));});
    input.write(new TextEncoder().encode('"😀"')); parser.reset();
    input.write(new TextEncoder().encode('"П"')); input.end();
    expect(values).toEqual(['😀','П']); expect(errors).toHaveLength(2);
    expect((errors[0] as Error).message).toMatch(/re-entered/);
});
test('Web and Node transports preserve JSONL BOM and fatal UTF-8 rules', async () => {
    const bytes = new TextEncoder().encode('\ufeff{}\n');
    const parser = new JsonLinesParser(), writer = parser.writable.getWriter();
    await expect(writer.write(bytes)).rejects.toThrow(/BOM/);
    const node = createNodeWritable(new JsonLinesParser());
    const done = finished(node); node.end(bytes);
    await expect(done).rejects.toThrow(/BOM/);
    const bad = new JsonLinesParser().writable.getWriter();
    await expect(bad.write(Uint8Array.of(34,0xff,34,10))).rejects.toThrow();
});
test('transport preserves BOM decoding across cuts and empty byte writes', () => {
    const bytes = new TextEncoder().encode('\ufeff{"text":"😀"}');
    for (let cut = 0; cut <= bytes.length; ++cut) {
        const parser = new JsonParser(); let root: unknown;
        parser.onValue('$', v => root = v);
        const input = createDecodedInput(parser);
        input.write(bytes.subarray(0,cut)); input.write(new Uint8Array());
        input.write(bytes.subarray(cut)); input.end(); input.end();
        expect(root).toEqual({text:'😀'});
        expect(() => input.write(new Uint8Array())).toThrow(/closed/);
    }
});
test('transport rejects mixed input before consuming it and allows recovery', () => {
    const parser = new JsonParser(); let root: unknown;
    parser.onValue('$', v => root = v);
    const input = createDecodedInput(parser);
    input.write(Uint8Array.of(34,0xf0,0x9f));
    expect(() => input.write('broken')).toThrow(TypeError);
    input.write(Uint8Array.of(0x98,0x80,34)); input.end();
    expect(root).toBe('😀');
});
test('transport cancellation drops pending UTF-8 and completes consumers only once', () => {
    const parser = new JsonParser(); let completed = 0;
    parser.onValue('$', {next:()=>{}, complete:()=>completed++});
    const input = createDecodedInput(parser);
    input.write(Uint8Array.of(34,0xe2)); input.destroy(); input.destroy(); input.end();
    expect(completed).toBe(1); expect(parser.closed).toBe(true);
    expect(() => input.write('')).toThrow(/closed/);
});
test('transport remembers a falsy sink failure and does not call the sink again', () => {
    let calls = 0;
    const input = createDecodedInput({write(){calls++; throw undefined;},end(){calls++;},destroy(){}});
    for (const call of [()=>input.write(''),()=>input.write(''),()=>input.end()]) {
        let thrown = false;
        try {call();} catch (error) {thrown = true; expect(error).toBeUndefined();}
        expect(thrown).toBe(true);
    }
    expect(calls).toBe(1);
});

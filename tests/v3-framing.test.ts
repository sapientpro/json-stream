import {captureRoot, capturedRoot} from './v3-capture';
import {test, expect, describe} from '@jest/globals';
import {Any, JsonParser, Json5Parser, PrefixFilter, JsonLinesParser, PrefixedJsonParser} from '../src/v3/index';
import {createNodeWritable} from '../src/v3/node';
import {finished} from 'node:stream/promises';
const encoder = new TextEncoder();

for (const format of ['json', 'json5'] as const) describe(format + ' records', () => {
    const record = format === 'json' ? '{"items":[{"id":1,"s":"😀\\nmarker:"}]}' : "{items:[{id:1,s:'😀\\nmarker:'}]}";
    test('JSONL preserves values, paths, record indexes and fragments at every byte cut', () => {
        const bytes = encoder.encode(record + '\r\n' + record);
        for (let cut = 0; cut <= bytes.length; cut++) {
            const p = new JsonLinesParser({format });
            const values: unknown[] = [], strings: string[] = [], ends: unknown[] = [];
            let complete = 0;
            p.onValue(['items',Any,'id'], {next:(v,path,index)=>values.push([v,path,index]), complete:()=>complete++});
            p.onString(['items',Any,'s'], {next:s=>strings.push(s),end:(path,index)=>ends.push([path,index])});
            p.write(bytes.subarray(0,cut)); p.write(bytes.subarray(cut)); p.end();
            expect(values).toEqual([[1,['items',0,'id'],0],[1,['items',0,'id'],1]]);
            expect(strings.join('')).toBe('😀\nmarker:😀\nmarker:');
            expect(ends).toEqual([[['items',0,'s'],0],[['items',0,'s'],1]]);
            expect(p.recordCount).toBe(2); expect(p.finished).toBe(true); expect(complete).toBe(1);
        }
    });
    test('prefix manager resumes searching and ignores markers inside strings at every cut', () => {
        const input = 'noise marker:' + record + 'discard marker:' + record;
        const bytes = encoder.encode(input);
        for (let cut = 0; cut <= bytes.length; cut++) {
            const p = new PrefixedJsonParser('marker:', {format}); const roots: unknown[] = [];
            p.onRecord((value,index)=>roots.push([value,index]));
            p.write(bytes.subarray(0,cut)); p.write(bytes.subarray(cut)); p.end();
            expect(roots).toEqual([[{items:[{id:1,s:'😀\nmarker:'}]},0],[{items:[{id:1,s:'😀\nmarker:'}]},1]]);
            expect(p.recordCount).toBe(2); expect(p.finished).toBe(true);
        }
    });
    test('scalar records and EOF numbers complete correctly', () => {
        const p=new PrefixedJsonParser('data:',{format});const values:unknown[]=[];
        p.onRecord(v=>values.push(v));
        for(const ch of 'data:1 data:true data:null data:"x"data:42')p.write(ch);
        p.end();expect(values).toEqual([1,true,null,'x',42]);expect(p.recordCount).toBe(5);
    });
});

test('JSONL strict by default, JSON5 explicit, and multiline JSON5 unsupported', () => {
    expect(()=>{const p=new JsonLinesParser();p.write("{a:1}\n");}).toThrow(SyntaxError);
    for(const input of ["{a:'x\\\ny'}\n",'/*a\nb*/{a:1}\n','{\n"a":1}\n']) {
        expect(()=>{const p=new JsonLinesParser({format:'json5'});p.write(input);p.end();}).toThrow(SyntaxError);
    }
    const p=new JsonLinesParser({format:'json5'});let value:unknown;p.onRecord(v=>value=v);p.write("{a:'x\\ny'}\n");p.end();expect(value).toEqual({a:'x\ny'});
});

test('empty input, empty lines, CRLF, scalar lines and last LF rules', () => {
    const empty=new JsonLinesParser();empty.end();expect(empty.recordCount).toBe(0);
    for(const input of ['\n',' \n','1\n\n','1\n\r\n'])expect(()=>{const p=new JsonLinesParser();p.write(input);p.end();}).toThrow(SyntaxError);
    const p=new JsonLinesParser();const values:unknown[]=[];p.onRecord(v=>values.push(v));p.write('null\r\n1\n"x"\n');p.end();expect(values).toEqual([null,1,'x']);expect(p.recordCount).toBe(3);
});

test('BOM is rejected even when split, with either format', () => {
    for(const format of ['json','json5'] as const)for(let cut=0;cut<4;cut++) {
        const bytes=encoder.encode('\ufeff{}\n');const p=new JsonLinesParser({format});
        expect(()=>{p.write(bytes.subarray(0,cut));p.write(bytes.subarray(cut));p.end();}).toThrow(/BOM/);
    }
});

test('prefix filter holds split markers, forwards payload only, and validates EOF', () => {
    for(const Parser of [JsonParser,Json5Parser])for(let cut=0;cut<20;cut++) {
        const p=captureRoot(new Parser({collectJson:true}));const filter=new PrefixFilter(p,'€START');
        const bytes=encoder.encode('garbage€START{"x":1}');filter.write(bytes.subarray(0,cut));filter.write(bytes.subarray(cut));filter.end();
        expect(capturedRoot(p)).toEqual({x:1});expect(p.json).toBe('{"x":1}');expect(filter.finished).toBe(true);
    }
    expect(()=>new PrefixFilter(captureRoot(new JsonParser()),'')).toThrow(TypeError);
    const p=new PrefixFilter(captureRoot(new JsonParser()),'start');p.write('sta');expect(()=>p.end()).toThrow(/not found/);
    const missing=new PrefixedJsonParser('start');missing.write('sta');expect(()=>missing.end()).toThrow(/not found/);
    const unfinished=new PrefixedJsonParser('start');unfinished.write('start');expect(()=>unfinished.end()).toThrow(SyntaxError);
});

test('fragments arrive before line completion without buffering the entire record', () => {
    const p=new JsonLinesParser({});let text='';p.onString(['s'],v=>text+=v);
    p.write('{"s":"hello');expect(text).toBe('hello');expect(p.recordCount).toBe(0);
    p.write(' world"}\n');p.end();expect(text).toBe('hello world');
});

test('unsubscribe persists across records, first-match promises and missing values', async () => {
    const p=new JsonLinesParser();const first=p.getValue<number>(['x']);let calls=0;
    const handle=p.onValue(['x'],()=>{calls++;handle.unsubscribe();});
    p.write('{"x":1}\n{"x":2}\n');p.end();expect(await first).toBe(1);expect(calls).toBe(1);
    const missing=new JsonLinesParser();const value=missing.getValue(['missing']);const assertion=expect(value).rejects.toThrow(/No value/);missing.end();await assertion;
});

test('callbacks isolated, reentry rejected, destroy stops current input and EOF completion', () => {
    const errors:unknown[]=[];const p=new JsonLinesParser({onObserverError:e=>errors.push(e)});
    let completed=0;p.onValue([], {next:()=>p.write('1'),complete:()=>completed++});p.onRecord(()=>p.destroy());
    p.write('1\n2\n');expect(errors).toHaveLength(1);expect(p.closed).toBe(true);expect(p.finished).toBe(false);expect(completed).toBe(1);expect(p.recordCount).toBe(0);
    const eof=new PrefixedJsonParser('data:');eof.onRecord(()=>eof.destroy());eof.write('data:12');eof.end();expect(eof.finished).toBe(false);
});

test('error and completion occur once for the whole input, not each record', () => {
    const p=new JsonLinesParser();let failures=0,complete=0;p.onValue([], {next:()=>{},error:()=>failures++,complete:()=>complete++});
    p.write('1\n');expect(complete).toBe(0);expect(()=>p.write('[1,]\n')).toThrow(SyntaxError);expect(failures).toBe(1);expect(complete).toBe(0);expect(()=>p.end()).toThrow();
    expect(()=>p.onValue([],()=>{})).toThrow();
});

test('Web and Node input wrappers accept both managers', async () => {
    for(const p of [new JsonLinesParser(),new PrefixedJsonParser('data:')]) {
        const values:unknown[]=[];p.onRecord(v=>values.push(v));
        const input=p instanceof JsonLinesParser?'1\n2\n':'data:1 data:2';
        await new ReadableStream<string>({start(c){c.enqueue(input);c.close();}}).pipeTo(p.writable);expect(values).toEqual([1,2]);
    }
    const p=new JsonLinesParser();const values:unknown[]=[];p.onRecord(v=>values.push(v));const sink=createNodeWritable(p);sink.end(Buffer.from('1\n2'));await finished(sink);expect(values).toEqual([1,2]);
});

test('JSONPath selectors are shared across records and do not prefix paths with record indexes', () => {
    const p=new JsonLinesParser({});const found:unknown[]=[];p.onValue('$.a[0]',(v,path,index)=>found.push([v,path,index]));p.write('{"a":[1]}\n{"a":[2]}');p.end();expect(found).toEqual([[1,['a',0],0],[2,['a',0],1]]);
    expect(()=>new JsonLinesParser().onValue(['x',-1],()=>{})).toThrow();
});

test('mixed input is rejected before consumption and empty writes freeze registration', () => {
    const p=new JsonLinesParser();p.write('');expect(()=>p.write(encoder.encode('1'))).toThrow(TypeError);expect(()=>p.onRecord(()=>{})).toThrow();p.write('1');p.end();expect(p.recordCount).toBe(1);
});


test('prefix JSON5 accepts multiline structures and comments without scanning a second grammar', () => {
    const input = "noise @ { /* @ \n comment */ a:'@', s:'hello\\\nworld', nested:[{b:1}] } trailer @ {a:2}";
    const bytes=encoder.encode(input);
    for(let cut=0;cut<=bytes.length;cut++) {
        const p=new PrefixedJsonParser('@',{format:'json5'});const roots:unknown[]=[];p.onRecord(v=>roots.push(v));
        p.write(bytes.subarray(0,cut));p.write(bytes.subarray(cut));p.end();
        expect(roots).toEqual([{a:'@',s:'helloworld',nested:[{b:1}]},{a:2}]);
    }
});

test('record string streams complete at input EOF and cancellation spans all records', async () => {
    const p=new JsonLinesParser();const stream=p.stringStream(['s']);p.write('{"s":"a"}\n{"s":"b"}');p.end();
    let text='';for await(const part of stream)text+=part;expect(text).toBe('ab');
    const q=new PrefixedJsonParser('@');const canceled=q.stringStream(['s']);await canceled.cancel();q.write('@{"s":"a"}@{"s":"b"}');q.end();expect(q.recordCount).toBe(2);
});


for(const Parser of [JsonParser,Json5Parser]) test(Parser.name+' reset preserves subscriptions, validates EOF, and clears per-document state',()=>{
    const p=captureRoot(new Parser({collectJson:true}));const values:unknown[]=[];let completes=0;
    p.onValue([], {next:v=>values.push(v),complete:()=>completes++});
    p.write('12');p.reset();expect(values).toEqual([12]);expect(capturedRoot(p)).toBeUndefined();expect(p.rootReady).toBe(false);expect(p.finished).toBe(false);expect(p.json).toBe('');expect(completes).toBe(0);
    p.write('{"x":[1]}');p.reset();p.write('"last"');p.end();expect(values).toEqual([12,{x:[1]},'last']);expect(completes).toBe(1);expect(p.finished).toBe(true);expect(()=>p.reset()).toThrow(/closed/);
    const bad=captureRoot(new Parser());bad.write('{"x":');expect(()=>bad.reset()).toThrow(SyntaxError);expect(bad.closed).toBe(true);
});

test('reset preserves unsubscription, matching caches, input mode and reentry protection',()=>{
    const errors:unknown[]=[];const p=new JsonParser({onObserverError:e=>errors.push(e)});const found:unknown[]=[];
    const once=p.onValue(['x',Any],v=>{found.push(v);once.unsubscribe();});
    p.onValue(['x'],()=>p.reset());p.write('{"x":[1,2]}');p.reset();p.write('{"x":[3,4]}');p.end();expect(found).toEqual([1]);expect(errors).toHaveLength(2);
    const bytes=captureRoot(new JsonParser());bytes.write(encoder.encode('1'));bytes.reset();expect(()=>bytes.write('2')).toThrow(TypeError);bytes.write(encoder.encode('2'));bytes.end();expect(capturedRoot(bytes)).toBe(2);
});


test('record resets preserve heterogeneous trees and owned paths across many records',()=>{
    const roots=Array.from({length:100},(_,id)=>({id,items:Array.from({length:id%5},(_,n)=>({n,text:'😀'+id+'\n'})),['unique'+id]:id%2?null:[true,false],float:id%3?0.125:-1e20}));
    const input=roots.map(root=>JSON.stringify(root)).join('\n');const bytes=encoder.encode(input);
    const p=new JsonLinesParser({});const received:unknown[]=[];const paths:unknown[]=[];p.onRecord((v,index)=>received.push([v,index]));p.onValue(['items',Any,'n'],(_v,path,index)=>paths.push([path,index]));
    for(let pos=0;pos<bytes.length;){const width=pos%31+1;p.write(bytes.subarray(pos,pos+width));pos+=width;}p.end();
    expect(received).toEqual(roots.map((root,index)=>[root,index]));expect(p.recordCount).toBe(100);expect(paths[0]).toEqual([['items',0,'n'],1]);
});


test('JSONL rejects invalid and truncated UTF-8, including at input EOF',()=>{
    for(const invalid of [[0xc0,0xaf],[0xed,0xa0,0x80],[0xff],[0xe2,0x82]]) {
        for(let cut=0;cut<=invalid.length;cut++) {
            const p=new JsonLinesParser();let errors=0;p.onValue([],{next:()=>{},error:()=>errors++});
            expect(()=>{p.write(Uint8Array.of(34));p.write(Uint8Array.from(invalid.slice(0,cut)));p.write(Uint8Array.from(invalid.slice(cut)));p.end();}).toThrow();
            expect(p.closed).toBe(true);expect(p.finished).toBe(false);expect(errors).toBe(1);
        }
    }
});

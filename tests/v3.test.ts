import { decodedInput } from './v3-input';
import {captureRoot, capturedRoot} from './v3-capture';
import {describe, test, expect} from '@jest/globals';
import {JsonParser, Json5Parser, Any, Rest, compileJsonPath, createParser} from '../src/v3/index';
import {JsonStream, createNodeWritable} from '../src/v3/node';
import {finished} from 'node:stream/promises';

const enc = new TextEncoder();
for (const Parser of [JsonParser, Json5Parser]) describe(Parser.name, () => {
  const input = '{"ignored":{"deep":[{"key":"unused"}]},"items":[{"id":1,"text":"😀a"},{"id":2,"text":"b"}],"0":"object","empty":"","__proto__":{"x":1}}';
  test('selective retention restores context after skipped keys at every byte boundary', () => {
    const bytes = enc.encode(input);
    for (let cut = 0; cut <= bytes.length; cut++) {
      const p = new Parser({});
      const values: unknown[] = [];
      p.onValue(['items',Any,'id'], (v,path) => values.push([v,path]));
      p.onValue(['0'], (v,path) => values.push([v,path]));
      p.onValue([0], () => {throw Error('numeric selector matched object');});
      decodedInput(p).write(bytes.subarray(0,cut)); decodedInput(p).write(bytes.subarray(cut)); decodedInput(p).end();
      expect(values).toEqual([[1,['items',0,'id']],[2,['items',1,'id']],['object',['0']]]);
      expect(capturedRoot(p)).toBeUndefined(); expect(p.finished).toBe(true);
    }
  });
  test('root subscription retains complete value without retainRoot', () => {
    const p = new Parser({}); let root: any;
    p.onValue([], v => root=v); p.write(input); p.end();
    expect(root).toEqual(JSON.parse(input)); expect(Object.getPrototypeOf(root)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(root,'__proto__')).toBe(true);
    expect(capturedRoot(p)).toBeUndefined();
  });
  test('wildcards, terminal Rest and overlapping selectors own concrete paths', () => {
    const p = new Parser({}); const found: unknown[]=[];
    p.onValue([Rest], (v,path)=>found.push([v,path]));
    let saved: readonly (string|number)[] | undefined;
    p.onValue(['a',Any], (_v,path)=>saved??=path);
    p.write('{"a":[1,2]}'); p.end();
    expect(saved).toEqual(['a',0]);
    expect(found.map((x:any)=>x[1])).toEqual([['a',0],['a',1],['a']]);
    expect(()=>captureRoot(new Parser()).onValue([Rest,'a'],()=>{})).toThrow();
  });
  test('string fragments survive every byte cut and cancellation preserves retained root', () => {
    const bytes=enc.encode('{"s":"😀\\uD83D\\uDE00\\nxyz","empty":""}');
    for(let cut=0;cut<=bytes.length;cut++) {
      const p=captureRoot(new Parser()); let text=''; const ends: unknown[]=[];
      const handle=p.onString(['s'], {next(v){text+=v;handle.unsubscribe();},end(path){ends.push(path);}});
      p.onString(['empty'], {next(){throw Error('empty fragment');},end:path=>ends.push(path)});
      decodedInput(p).write(bytes.subarray(0,cut)); decodedInput(p).write(bytes.subarray(cut)); decodedInput(p).end();
      expect(capturedRoot(p)).toEqual({s:'😀😀\nxyz',empty:''}); expect(ends).toContainEqual(['empty']);
      if(text.length) {const code=text.charCodeAt(text.length-1);expect(code < 0xD800 || code > 0xDBFF).toBe(true);}
    }
  });
  test('per-string end is distinct from document completion', () => {
    const p=new Parser({}); const events: unknown[]=[];
    p.onString([Any], {next:(v,path)=>events.push([v,path]),end:path=>events.push(['end',path]),complete:()=>events.push('complete')});
    p.write('["a","","b"]'); expect(events).not.toContain('complete'); p.end();
    expect(events).toEqual([['a',[0]],['end',[0]],['end',[1]],['b',[2]],['end',[2]],'complete']);
  });
  test('callbacks can stop parsing; errors are isolated; reentry is rejected', () => {
    const errors: unknown[]=[]; const p=captureRoot(new Parser({onObserverError:e=>errors.push(e)}));
    p.onValue([Any],()=>p.write('0')); const values: unknown[]=[]; p.onValue([Any],v=>values.push(v));
    p.write('[1,2]'); p.end(); expect(values).toEqual([1,2]); expect(errors).toHaveLength(2);
    const stopped=captureRoot(new Parser()); stopped.onString(['s'],()=>stopped.destroy());
    stopped.write('{"s":"value","after":1}'); expect(stopped.closed).toBe(true); expect(stopped.finished).toBe(false);
  });
  test('first value promise, missing values and terminal syntax errors', async () => {
    const p=new Parser({}); const first=p.getValue([Any]); p.write('[1,2]');p.end();expect(await first).toBe(1);
    const missing=captureRoot(new Parser()); const absent=missing.getValue(['absent']); const rejection=expect(absent).rejects.toThrow('No value'); missing.write('{}');missing.end();await rejection;
    const bad=captureRoot(new Parser());bad.write('{}');expect(bad.rootReady).toBe(true);expect(bad.finished).toBe(false);expect(()=>bad.write('x')).toThrow(SyntaxError);expect(bad.closed).toBe(true);
  });
  test('destroy during EOF cannot mark the document successful and EOF remains guarded', () => {
    const canceled=captureRoot(new Parser());canceled.onValue([],()=>canceled.destroy());canceled.write('42');canceled.end();expect(canceled.closed).toBe(true);expect(canceled.finished).toBe(false);
    const errors: unknown[]=[];const guarded=captureRoot(new Parser({onObserverError:e=>errors.push(e)}));guarded.onValue([],()=>guarded.write('0'));guarded.write('42');guarded.end();expect(errors).toHaveLength(1);expect((errors[0] as Error).message).toContain('re-entered');expect(capturedRoot(guarded)).toBe(42);
  });
  test('destroy from error callback preserves errors for remaining consumers', () => {
    const p=captureRoot(new Parser());const events: unknown[]=[];
    p.onValue(['a'],{next(){},error(e){events.push(e);p.destroy();}});
    p.onValue(['b'],{next(){},error:e=>events.push(e),complete:()=>events.push('wrong completion')});
    expect(()=>p.write('{oops}')).toThrow(SyntaxError);expect(events).toHaveLength(2);expect(events[0]).toBeInstanceOf(SyntaxError);expect(events[1]).toBe(events[0]);
  });
  test('input mode and registration are fixed before first write', () => {
    const p=captureRoot(new Parser());decodedInput(p).write('');expect(()=>p.onValue([],()=>{})).toThrow('before');expect(()=>decodedInput(p).write(enc.encode('{}'))).toThrow(TypeError);decodedInput(p).write('{}');decodedInput(p).end();
    expect(()=>decodedInput(p).write(' ')).toThrow('closed');
    expect(()=>captureRoot(new Parser({maxDepth:-1}))).toThrow(RangeError);expect(()=>captureRoot(new Parser({maxDepth:0})).write('[]')).toThrow();
  });
  test('Web string cancellation and bounded queues leave parser usable', async () => {
    const p=captureRoot(new Parser()); const stream=p.stringStream(['s']);const reader=stream.getReader();
    p.write('{"s":"abc');expect((await reader.read()).value).toBe('abc');await reader.cancel();p.write('def"}');p.end();expect(capturedRoot(p)).toEqual({s:'abcdef'});
    const bounded=captureRoot(new Parser({maxBufferedChunks:1}));const output=bounded.stringStream([]);bounded.write('"a');bounded.write('b');bounded.write('"');bounded.end();await expect(output.getReader().read()).rejects.toThrow(RangeError);
    const transport=captureRoot(new Parser());const writer=transport.writable.getWriter();await writer.write(enc.encode('{"x":1}'));await writer.close();expect(transport.finished).toBe(true);
  });
});

describe('JSON grammar and JSON5 dialect',()=>{
  const invalid=['[1,]','{"a":1,}','[1 2]','{"a":1 "b":2}','01','-01','1.','1e','"\\x41"','"\n"','true false'];
  test.each(invalid)('strict JSON rejects %j at every split', text=>{
    for(let cut=0;cut<=text.length;cut++){const p=captureRoot(new JsonParser());expect(()=>{p.write(text.slice(0,cut));p.write(text.slice(cut));p.end();}).toThrow(SyntaxError);}
  });
  test('all raw JSON controls are rejected beyond the native string scan prefix',()=>{
    for(let code=0;code<32;code++)for(const at of [0,31,32,33,64,4096]) {
      const text='"'+'a'.repeat(at)+String.fromCharCode(code)+'b'.repeat(100)+'"';
      for(const cut of [1,at+1,at+2,text.length])expect(()=>{const p=captureRoot(new JsonParser());p.write(text.slice(0,cut));p.write(text.slice(cut));p.end();}).toThrow(SyntaxError);
    }
  });
  test('bounded native segment validation rejects controls and preserves lone surrogates',()=>{
    for(let code=0;code<32;code++) {
      const p=captureRoot(new JsonParser());p.write('"');
      expect(()=>p.write('a'.repeat(8192)+String.fromCharCode(code)+'b'.repeat(8191))).toThrow(SyntaxError);
    }
    for(const char of ['😀','€','\uD800','\uDC00']){
      const p=captureRoot(new JsonParser());p.write('"');const part='a'.repeat(8192)+char+'b'.repeat(8192);p.write(part);p.write('"');p.end();expect(capturedRoot(p)).toBe(part);
    }
  });
  test('JSON5 extended grammar, fragmented escapes and numbers',()=>{
    const text="/*before*/ {unquoted:'a\\x41\\u0042\\\nC', n:+.5, hex:-0x10, inf:Infinity, nan:NaN, list:[true,null,],} //end";
    for(let cut=0;cut<=text.length;cut++){const p=captureRoot(new Json5Parser());p.write(text.slice(0,cut));p.write(text.slice(cut));p.end();expect(capturedRoot(p)).toEqual({unquoted:'aABC',n:.5,hex:-16,inf:Infinity,nan:NaN,list:[true,null]});}
  });
  test.each(['{\\uD800:1}','{\\uD835\\uDC00:1}','{a:1/*','0x','+','[.e2]'])('JSON5 rejects %j',text=>{expect(()=>{const p=captureRoot(new Json5Parser());p.write(text);p.end();}).toThrow(SyntaxError);});
  test('factory defaults to strict JSON',()=>{expect(createParser()).toBeInstanceOf(JsonParser);expect(createParser({format:'json5'})).toBeInstanceOf(Json5Parser);});
});

describe('JSONPath subset',()=>{
  test('promise convenience rejects invalid queries consistently',async()=>{await expect(captureRoot(new JsonParser()).getValue('$[0:2]')).rejects.toThrow(SyntaxError);});
  test('typed index and property selectors',()=>{
    expect(compileJsonPath('$ .items [0]["id"]')).toEqual(['items',0,'id']);expect(Object.isFrozen(compileJsonPath('$'))).toBe(true);
    const p=new JsonParser({});const values: unknown[]=[];
    p.onValue('$.*[0]',(v,path)=>values.push([v,path]));p.write('{"array":[7],"object":{"0":8}}');p.end();expect(values).toEqual([[7,['array',0]]]);
  });
  test.each(['$..id','$[?(@.x)]','$[0:2]','$[-1]','$[0,1]','$ ','$["\\uD800"]','$["\\uDC00"]'])('rejects unsupported/invalid query %s',query=>expect(()=>compileJsonPath(query)).toThrow());
});

describe('Node adapters',()=>{
  test('numeric root commits at EOF and emits once',async()=>{
    const s=captureRoot(new JsonStream());const values: unknown[]=[];s.on('value',v=>values.push(v));s.end('42');await finished(s);expect(values).toEqual([42]);expect(s.parsed).toBe(true);
  });
  test('JSON5 Node transport and standalone wrapper',async()=>{
    const s=captureRoot(new JsonStream({format:'json5'}));const result=s.getValue(['id']);s.end('{id:0x10}');await finished(s);expect(await result).toBe(16);
    const p=captureRoot(new JsonParser());const transport=createNodeWritable(p);transport.end(Buffer.from('[1]'));await finished(transport);expect(capturedRoot(p)).toEqual([1]);
  });
});

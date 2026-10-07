import {describe, expect, test} from '@jest/globals';
import {JsonParser} from '../src/v3/index';

describe('incremental object keys', () => {
    test('discarded nested keys preserve sibling selection across every UTF-8 split', () => {
        const input = '{"items":[{"ignored":{"":0,"__proto__":1,"a\\u0041":2,"😀":3,"'
            + 'long'.repeat(80) + '":4},"id":1},{"id":2,"ignored":{"x":3}}]}';
        const bytes = new TextEncoder().encode(input);
        for (let cut = 0; cut <= bytes.length; cut++) {
            const parser = new JsonParser(), selected: unknown[] = [];
            parser.onValue('$.items[*].id', (value, path) => selected.push([value, path]));
            parser.write(bytes.subarray(0, cut));
            parser.write(bytes.subarray(cut));
            parser.end();
            expect(selected).toEqual([[1, ['items', 0, 'id']], [2, ['items', 1, 'id']]]);
        }
    });
    test.each(Array.from({length:32}, (_, code) => code))('rejects raw control %i inside discarded nested keys', code => {
        const input = '{"ignored":{"' + 'a'.repeat(80) + String.fromCharCode(code) + '":1},"id":2}';
        for (const cut of [0, 12, 43, 76, 92, input.length]) {
            const parser = new JsonParser();
            parser.onValue('$.id', () => {});
            expect(() => { parser.write(input.slice(0, cut)); parser.write(input.slice(cut)); parser.end(); }).toThrow(SyntaxError);
        }
    });
    test('discarded keys stay validated after disabling the repeated-key cache', () => {
        const distinct = Object.fromEntries(Array.from({length:40}, (_, i) => ['key' + i, i]));
        const prefix = '[{"id":0,' + JSON.stringify(distinct).slice(1, -1) + ',';
        for (const key of ['bad\\q', 'bad\\u00z0', 'a'.repeat(80) + '\u0001']) {
            const parser = new JsonParser();
            parser.onValue('$[*].id', () => {});
            expect(() => { parser.write(prefix + '"ignored":{"' + key + '":1},"id":2}]'); parser.end(); }).toThrow(SyntaxError);
        }
    });
    test('retains plain, escaped and Unicode keys across every UTF-8 split', () => {
        const input = '{"":0,"__proto__":1,"a\\u0041":2,"😀":3,"'+'long'.repeat(80)+'":4}';
        const bytes = new TextEncoder().encode(input);
        for (let cut=0;cut<=bytes.length;cut++) {
            const parser=new JsonParser();let root:unknown;const selected:unknown[]=[];
            parser.onValue('$',value=>root=value);
            parser.onValue('$.*',(value,path)=>selected.push([value,path]));
            parser.write(bytes.subarray(0,cut));parser.write(bytes.subarray(cut));parser.end();
            expect(root).toEqual(JSON.parse(input));
            expect(Object.getPrototypeOf(root)).toBe(Object.prototype);
            expect(Object.hasOwn(root as object,'__proto__')).toBe(true);
            expect(selected).toEqual([[0,['']],[1,['__proto__']],[2,['aA']],[3,['😀']],[4,['long'.repeat(80)]]]);
        }
    });
    test.each(Array.from({length:32},(_,code)=>code))('rejects raw control %i in unrequested long keys', code => {
        const input='{"'+ 'a'.repeat(80)+String.fromCharCode(code)+'":1}';
        for (const cut of [0,1,31,33,80,81,82,input.length]) {
            const parser=new JsonParser();parser.onValue('$.wanted',()=>{});
            expect(()=>{parser.write(input.slice(0,cut));parser.write(input.slice(cut));parser.end();}).toThrow(SyntaxError);
        }
    });
    test('selected keys and string fragments preserve paths across reset', () => {
        const parser=new JsonParser(),events:unknown[]=[];
        parser.onValue('$.aA', (value,path)=>events.push([value,path]));
        parser.onString('$.text',(value,path)=>events.push([value,path]));
        parser.write('{"a\\u0041":1,"text":"first"}');parser.reset();
        parser.write('{"aA":2,"text":"second"}');parser.end();
        expect(events).toEqual([[1,['aA']],['first',['text']],[2,['aA']],['second',['text']]]);
    });
    test('repeated, colliding and prefix keys preserve values and paths at every byte cut', () => {
        const value=Array.from({length:4},(_,id)=>({name:id,note:'😀',name2:true,'.':null,a:1,'!':2,
            '':3,['long'.repeat(12)]:id}));
        const input=JSON.stringify(value),bytes=new TextEncoder().encode(input);
        for(let cut=0;cut<=bytes.length;cut++) {
            const parser=new JsonParser();let root:unknown;const selected:unknown[]=[];
            parser.onValue('$',v=>root=v);
            parser.onValue('$[*].*',(v,path)=>selected.push([v,path]));
            parser.write(bytes.subarray(0,cut));parser.write(bytes.subarray(cut));parser.end();
            expect(root).toEqual(value);
            expect(selected).toEqual(value.flatMap((item,i)=>Object.entries(item).map(([key,v])=>[v,[i,key]])));
        }
    });
    test('previously seen keys do not conceal malformed continuations', () => {
        for(const key of ['name','long'.repeat(12)])for(const suffix of ['\n','\u0000','\\q']) {
            const input=' '.repeat(300)+'[{"'+key+'":0},{"'+key+'":1,"'+key+suffix+'":2}]';
            for(let cut=0;cut<=input.length;cut++) {
                const parser=new JsonParser();parser.onValue('$',()=>{});
                expect(()=>{parser.write(input.slice(0,cut));parser.write(input.slice(cut));parser.end();}).toThrow(SyntaxError);
            }
        }
    });
    test('new keys after many distinct keys and reset still match selectors', () => {
        const parser=new JsonParser(),values:unknown[]=[];
        parser.onValue('$[*].*',(v,path)=>values.push([v,path]));
        const first=Object.fromEntries(Array.from({length:600},(_,i)=>['key'+i,i]));
        parser.write(JSON.stringify([first]));parser.reset();
        parser.write('[{"name":1,"name2":2,"name":3,"n\\u006f te":4}]');parser.end();
        expect(values.slice(600)).toEqual([[1,[0,'name']],[2,[0,'name2']],[3,[0,'name']],[4,[0,'no te']]]);
    });
});

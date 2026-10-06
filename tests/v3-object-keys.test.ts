import {describe, expect, test} from '@jest/globals';
import {JsonParser} from '../src/v3/index';

describe('incremental object keys', () => {
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
});

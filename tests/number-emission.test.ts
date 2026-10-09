import { decodedInput } from './input';
import {describe, expect, test} from '@jest/globals';
import {JsonParser, Json5Parser, Rest} from '../src/index';

for (const Parser of [JsonParser, Json5Parser]) describe(Parser.name+' numeric emission', () => {
    test('root retention builds unmatched numbers alongside selected numeric callbacks', () => {
        const input = '{"items":[{"id":1.25,"other":[-0.0,1e400,12345678901234567890]}],"__proto__":2.5}';
        const bytes = new TextEncoder().encode(input);
        for (let cut=0; cut<=bytes.length; cut++) {
            const parser = new Parser(); const ids: unknown[] = []; let root: any;
            parser.onValue('$', value => root=value);
            parser.onValue('$.items[*].id', (value,path) => ids.push([value,path]));
            decodedInput(parser).write(bytes.subarray(0,cut)); decodedInput(parser).write(bytes.subarray(cut)); decodedInput(parser).end();
            expect(root).toEqual(JSON.parse(input)); expect(Object.is(root.items[0].other[0],-0)).toBe(true);
            expect(Object.getPrototypeOf(root)).toBe(Object.prototype);
            expect(Object.hasOwn(root,'__proto__')).toBe(true);
            expect(ids).toEqual([[1.25,['items',0,'id']]]);
        }
    });
    test.each(['{"ignored":1e+}', '{"ignored":1.2.3}', '{"ignored":01}'])('validates unrequested numeric grammar %s', input => {
        for (let cut=0; cut<=input.length; cut++) {
            const parser = new Parser(); parser.onString('$.text',()=>{});
            expect(()=>{parser.write(input.slice(0,cut));parser.write(input.slice(cut));parser.end();}).toThrow(SyntaxError);
        }
    });
    test('numeric callbacks can cancel, reset, and stop parsing', () => {
        const parser = new Parser(); const values: unknown[] = [];
        const subscription = parser.onValue([Rest], value => {values.push(value);subscription.unsubscribe();});
        parser.write('[1.25,2.5]'); parser.reset(); parser.write('[3.75]'); parser.end(); expect(values).toEqual([1.25]);
        const stopped = new Parser(); const received: unknown[] = [];
        stopped.onValue([Rest], value => {received.push(value);stopped.destroy();});
        stopped.write('[1.25,2.5]'); expect(received).toEqual([1.25]);expect(stopped.closed).toBe(true);expect(stopped.finished).toBe(false);
    });
    test('persistent numeric root observers retain delivery ordering across reset', () => {
        const parser = new Parser(); const received: unknown[] = [];
        parser.onValue('$', value => {expect(parser.rootReady).toBe(false);received.push(value);});
        parser.write('1.25'); parser.reset(); parser.write('-0.0'); parser.end();
        expect(received).toEqual([1.25,-0]);expect(parser.rootReady).toBe(true);
    });
});

test('JSON5 signed hexadecimal and nonfinite values match root and selected consumers', () => {
    const input='{items:[{id:-0x10,other:[+Infinity,-Infinity,NaN,-0x0,],},],}';
    for (let cut=0;cut<=input.length;cut++) {
        const parser=new Json5Parser();let root:any;const ids:number[]=[];
        parser.onValue('$',v=>root=v);parser.onValue<number>('$.items[*].id',v=>ids.push(v));
        parser.write(input.slice(0,cut));parser.write(input.slice(cut));parser.end();
        expect(ids).toEqual([-16]);expect(root.items[0].other.slice(0,3)).toEqual([Infinity,-Infinity,NaN]);expect(Object.is(root.items[0].other[3],-0)).toBe(true);
    }
});

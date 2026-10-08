import { decodedInput } from './v3-input';
import {describe, expect, test} from '@jest/globals';
import {JsonParser} from '../src/v3/index';

const text='a'.repeat(80)+('\n\\"😀\t\u0000/\\u1234').repeat(45);
const input=JSON.stringify({text,after:1});

describe('large escaped string fragments',()=>{
    test('preserves decoded values, paths and surrogate pairs at every UTF-8 cut',()=>{
        const bytes=new TextEncoder().encode(input);
        for(let cut=0;cut<=bytes.length;cut++){
            const parser=new JsonParser();let root:unknown;const fragments:string[]=[];let ended=0;
            parser.onValue('$',v=>root=v);
            parser.onString('$.text',{next:(fragment,path)=>{
                expect(path).toEqual(['text']);fragments.push(fragment);
                const last=fragment.charCodeAt(fragment.length-1);
                expect(last>=0xD800&&last<=0xDBFF).toBe(false);
            },end:path=>{expect(path).toEqual(['text']);ended++;}});
            decodedInput(parser).write(bytes.subarray(0,cut));decodedInput(parser).write(bytes.subarray(cut));decodedInput(parser).end();
            expect(fragments.join('')).toBe(text);expect(root).toEqual({text,after:1});expect(ended).toBe(1);
        }
    });
    test.each(['\\q','\\u00GG','\\uD8','\\'])('keeps parser errors for malformed or truncated escape %s',tail=>{
        const bad='{"text":"'+JSON.stringify(text).slice(1,-1)+tail+'"}';
        for(const cut of [0,64,256,bad.length-6,bad.length-3,bad.length]){
            const parser=new JsonParser();let completed=false;let observed:unknown;
            parser.onValue('$',()=>completed=true);
            parser.onString('$.text',{next:()=>{},error:error=>observed=error});
            let thrown:unknown;
            try{parser.write(bad.slice(0,cut));parser.write(bad.slice(cut));parser.end();}catch(error){thrown=error;}
            expect(thrown).toBeInstanceOf(SyntaxError);expect(observed).toBe(thrown);
            expect((thrown as Error).message).toMatch(/^Json syntax error at \d+$/);
            expect(completed).toBe(false);
        }
    });
    test('retains a full value after its fragment consumer cancels',()=>{
        const parser=new JsonParser();let root:unknown;let count=0;let ends=0;
        parser.onValue('$',v=>root=v);
        const subscription=parser.onString('$.text',{next:()=>{count++;subscription.unsubscribe();},end:()=>ends++});
        for(let i=0;i<input.length;i+=512)parser.write(input.slice(i,i+512));parser.end();
        expect(root).toEqual({text,after:1});expect(count).toBe(1);expect(ends).toBe(0);
    });
    test('destroy during a fragment stops root emission',()=>{
        const parser=new JsonParser();let root=false;let fragments=0;
        parser.onValue('$',()=>root=true);
        parser.onString('$.text',()=>{fragments++;parser.destroy();});
        parser.write(input);expect(fragments).toBe(1);expect(root).toBe(false);expect(parser.finished).toBe(false);
    });
});

import {describe, expect, test} from '@jest/globals';
import {JsonParser, Json5Parser} from '../src/v3/index';

const widths=[1,3,8,2,16,4,32,5,48,7];
const text='Український текст 😀漢字 '.repeat(12);

describe('token-sized string delivery',()=>{
    for(const Parser of [JsonParser,Json5Parser])for(const input of ['text','bytes']){
        test(`${Parser.name} delivers ${input} fragments before the next write`,()=>{
            const parser=new Parser(),encoder=new TextEncoder(),points=Array.from(text);
            let received='',root:unknown,ends=0;
            parser.onValue('$',value=>root=value);
            parser.onString('$.text',{next:(part,path)=>{
                expect(path).toEqual(['text']);received+=part;
                expect(/[\uD800-\uDBFF]$/.test(part)).toBe(false);
            },end:()=>ends++});
            const write=(part:string)=>parser.write(input==='text'?part:encoder.encode(part));
            write('{"text":"');
            let expected='';
            for(let at=0,n=0;at<points.length;n++){
                const width=widths[n%widths.length]!,part=points.slice(at,at+width).join('');
                at+=width;expected+=part;write(part);
                expect(received).toBe(expected);
                expect(ends).toBe(0);
            }
            write('"}');parser.end();
            expect(root).toEqual({text});expect(ends).toBe(1);
        });
    }
    for(const Parser of [JsonParser,Json5Parser]){
        test(`${Parser.name} retains strings across cancellation, surrogate-only writes and reset`,()=>{
            const parser=new Parser(),roots:unknown[]=[],fragments:string[]=[];
            let ends=0;
            parser.onValue('$',value=>roots.push(value));
            const subscription=parser.onString('$.text',{
                next:part=>{fragments.push(part);subscription.unsubscribe();},
                end:()=>ends++,
            });
            parser.write('{"text":"prefix');
            expect(fragments).toEqual(['prefix']);
            parser.write('\uD83D');parser.write('\uDE00tail"}');
            expect(roots).toEqual([{text:'prefix😀tail'}]);
            parser.reset();parser.write('{"text":"after"}');parser.end();
            expect(roots).toEqual([{text:'prefix😀tail'},{text:'after'}]);
            expect(fragments).toEqual(['prefix']);expect(ends).toBe(0);
        });
        test(`${Parser.name} keeps error offsets after fully consumed Unicode chunks`,()=>{
            const parser=new Parser(),encoder=new TextEncoder();
            const pieces=['{"text":"',...Array.from(text)];
            for(const part of pieces)parser.write(encoder.encode(part));
            // JSON5 reports after consuming the invalid character; JSON reports at it.
            const offset=pieces.join('').length+(Parser===Json5Parser?1:0);
            expect(()=>parser.write(encoder.encode('\n'))).toThrow(`Json syntax error at ${offset}`);
        });
    }
});

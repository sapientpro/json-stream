import {decodedInput} from './v3-input';
import {describe, expect, test} from '@jest/globals';
import {JsonParser, JsonLinesParser, PrefixedJsonParser, Any, Rest} from '../src/v3/index';

const bodies = ['[]', '{}', '[0,-0,1.25,2e-3,1E+2,true,false,null]',
    '{"a":{"b":["\\u0041","\\uD800","\\\\","\\\"",[],{}]},"__proto__":1}',
    '["π😀","a\\nb",-1e200,1e-200]'];

describe('unselected JSON subtrees', () => {
    test('resume selected values and owned paths at every text and byte cut', () => {
        for (const body of bodies) {
            const text = '{"skip":'+body+',"items":[{"id":1},{"id":2}]}';
            for (const input of [text,new TextEncoder().encode(text)]) for (let cut=0;cut<=input.length;cut++) {
                const parser = new JsonParser(), transport = decodedInput(parser), values: unknown[]=[];
                parser.onValue(['items',Any,'id'], (value,path)=>values.push([value,path]));
                transport.write(input.slice(0,cut)); transport.write(input.slice(cut)); transport.end();
                expect(values).toEqual([[1,['items',0,'id']],[2,['items',1,'id']]]);
                expect(parser.finished).toBe(true);
            }
        }
    });
    test('one-unit writes preserve skip state and the following value', () => {
        const text='{"skip":{"x":[-1.25e+3,true,null,"π😀\\u0041"]},"keep":"tail"}';
        for (const bytes of [false,true]) {
            const parser=new JsonParser(), transport=decodedInput(parser), values:unknown[]=[];
            parser.onValue('$.keep',value=>values.push(value));
            if(bytes)for(const byte of new TextEncoder().encode(text))transport.write(Uint8Array.of(byte));
            else for(let i=0;i<text.length;i++)transport.write(text[i]!);
            transport.end();expect(values).toEqual(['tail']);
        }
    });
    test('invalid syntax inside ignored branches is still rejected at every cut', () => {
        const invalid = ['[01]','[-01]','[1.]','[1e]','[1e+]','[--1]','[.1]','[+1]',
            '[truefalse]','[nul]','[{}{}]','[1,]','{"a":1,}','{"a" 1}',
            '["\\u12G4"]','["\\x41"]','["a\nb"]','["\\q"]','{"a":', '["unfinished'];
        for (const body of invalid) {
            const text='{"skip":'+body+',"keep":1}';
            for (let cut=0;cut<=text.length;cut++) {
                const parser=new JsonParser();parser.onValue('$.keep',()=>{});
                expect(()=>{parser.write(text.slice(0,cut));parser.write(text.slice(cut));parser.end();}).toThrow(SyntaxError);
            }
        }
    });
    test('depth counts include observed parents and ignored descendants', () => {
        const text='{"skip":[[{}]],"keep":1}';
        for (const maxDepth of [0,1,2,3]) {
            const parser=new JsonParser({maxDepth});parser.onValue('$.keep',()=>{});
            expect(()=>{parser.write(text);parser.end();}).toThrow(SyntaxError);
        }
        const parser=new JsonParser({maxDepth:4});parser.onValue('$.keep',()=>{});
        parser.write(text);parser.end();expect(parser.finished).toBe(true);
    });
    test('ancestor values and recursive selectors retain required descendants', () => {
        const document={skip:{nested:[{id:1,text:'π😀'}]},keep:2}, text=JSON.stringify(document);
        const parser=new JsonParser();let root: unknown;const ids: unknown[]=[];
        parser.onValue('$',value=>root=value);parser.onValue([Rest],(value,path)=>{if(path.at(-1)==='id')ids.push(value);});
        parser.write(text);parser.end();expect(root).toEqual(document);expect(ids).toEqual([1]);
    });
    test('a selected container collects unmatched descendants while siblings are skipped', () => {
        const document={skip:{discard:[1,2]},keep:{unselected:{nested:[{a:1}]},child:{id:7,also:[false,'x']}}};
        const parser=new JsonParser();let kept:unknown;const ids:unknown[]=[];
        parser.onValue('$.keep',value=>kept=value);parser.onValue('$.keep.child.id',value=>ids.push(value));
        const text=JSON.stringify(document);
        for(let pos=0;pos<text.length;pos+=11)parser.write(text.slice(pos,pos+11));parser.end();
        expect(kept).toEqual(document.keep);expect(ids).toEqual([7]);
    });
    test('streaming survives a skipped branch, reset and cancellation', () => {
        const parser=new JsonParser(), parts:string[]=[];let calls=0;
        const once=parser.onValue('$.keep',()=>{calls++;once.unsubscribe();});
        parser.onString('$.text',part=>parts.push(part));
        parser.write('{"skip":{"x":[1,2]},"keep":1,"text":"π');parser.write('😀"}');
        parser.reset();parser.write('{"skip":[false,null],"keep":2,"text":"next"}');parser.end();
        expect(parts.join('')).toBe('π😀next');expect(calls).toBe(1);
    });
    test('raw collection, EOF failures and destroy preserve lifecycle', () => {
        const parser=new JsonParser({collectJson:true});parser.onValue('$.keep',()=>{});
        const text='{"skip":[true],"keep":1}';parser.write(text);parser.end();expect(parser.json).toBe(text);
        const invalid=new JsonParser();let failure: unknown;
        invalid.onValue('$.keep',{next(){},error(error){failure=error;}});invalid.write('{"skip":[1e');
        expect(()=>invalid.end()).toThrow(SyntaxError);expect(failure).toBeInstanceOf(SyntaxError);
        const stopped=new JsonParser();let complete=0;stopped.onValue('$.keep',{next(){},complete(){complete++;}});
        stopped.write('{"skip":["unfinished');stopped.destroy();expect(complete).toBe(1);expect(stopped.finished).toBe(false);
    });
    test('record managers resume after skipped subtrees at every byte cut', () => {
        const record='{"skip":{"x":["marker:",1e3]},"keep":7}';
        for(const prefix of [false,true]) {
            const text=prefix?'marker:'+record+'noise marker:'+record:record+'\n'+record+'\n';
            const bytes=new TextEncoder().encode(text);
            for(let cut=0;cut<=bytes.length;cut++) {
                const parser=prefix?new PrefixedJsonParser('marker:'):new JsonLinesParser(), values:unknown[]=[];
                parser.onValue('$.keep',(value,path,index)=>values.push([value,path,index]));
                parser.write(bytes.subarray(0,cut));parser.write(bytes.subarray(cut));parser.end();
                expect(values).toEqual([[7,['keep'],0],[7,['keep'],1]]);expect(parser.recordCount).toBe(2);
            }
        }
    });
});

for (const memoryMode of ['fast','compact'] as const) test('managed tails after validation-only subtrees: '+memoryMode, () => {
    for (const body of bodies) {
        const document = '{"skip":'+body+',"keep":"π😀"}', suffix = ' tail😀';
        for (let cut=0;cut<=document.length;cut++) {
            const p=new JsonParser({strictEnd:false,memoryMode,collectJson:true});const values:unknown[]=[];
            p.onValue('$.keep',v=>values.push(v));
            expect(p.write(document.slice(0,cut))).toBe(0);
            if (!p.rootReady) expect(p.write(document.slice(cut)+suffix)).toBe(suffix.length);
            expect(p.json).toBe(document);p.reset();
            expect(p.end(document+suffix)).toBe(suffix.length);
            expect(values).toEqual(['π😀','π😀']);expect(p.finished).toBe(true);
        }
    }
});

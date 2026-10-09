import {DOCUMENT_INPUT} from '../src/document-input';
import {test, expect} from '@jest/globals';
import {JsonParser, Json5Parser, JsonLinesParser, PrefixedJsonParser, Any} from '../src/index';

for (const Parser of [JsonParser, Json5Parser]) for (const memoryMode of ['fast','compact'] as const) {
    test(Parser.name + ' ' + memoryMode + ' returns only the unconsumed suffix of the current chunk at every cut', () => {
        const documents = ['{}','[]','"😀\\ntext"','true','false','null','123','-0','1.25e-3',' {"x":[null,{"s":"π😀"}]}'];
        for (const document of documents) {
            const suffix = ' NEXT😀', input = document + suffix;
            for (let cut = 0; cut <= input.length; ++cut) {
                const parser = new Parser({memoryMode,strictEnd:false, collectJson:true}); let value: unknown;
                parser.onValue('$', v => value = v);
                const first = input.slice(0,cut), second = input.slice(cut);
                const unread = parser.write(first);
                const tail = parser.rootReady ? first.slice(first.length-unread)+second :
                    (() => {const left=parser.write(second);return second.slice(second.length-left);})();
                expect(tail).toBe(suffix); expect(value).toEqual(JSON.parse(document));
                expect(parser.json).toBe(document); expect(parser.rootReady).toBe(true);
                expect(parser.finished).toBe(false);
                expect(() => parser.write('')).toThrow(/reset/);
                expect(parser.end()).toBe(0); expect(parser.finished).toBe(true);
            }
        }
    });
    test(Parser.name + ' ' + memoryMode + ' returns zero for accepted partial tokens and supports EOF chunks', () => {
        const parser = new Parser({memoryMode,strictEnd:false}); let value: unknown;
        parser.onValue('$', v => value = v);
        expect(parser.write('12')).toBe(0); expect(parser.rootReady).toBe(false);
        expect(parser.end('.5')).toBe(0); expect(value).toBe(12.5);
        const stopped = new Parser({memoryMode,strictEnd:false});
        expect(stopped.end('{} remainder')).toBe(' remainder'.length);
        expect(stopped.finished).toBe(true);
    });
    test(Parser.name + ' ' + memoryMode + ' default strict mode validates all chunks and end(text)', () => {
        const parser = new Parser({memoryMode});
        expect(parser.write('{}')).toBe(0); expect(parser.write(' \r\n')).toBe(0);
        expect(parser.end('\t')).toBe(0); expect(parser.finished).toBe(true);
        const extra = new Parser({memoryMode}); extra.write('{}'); expect(() => extra.end('x')).toThrow(SyntaxError);
        expect(() => new Parser({memoryMode}).end('{}[]')).toThrow(SyntaxError);
        for (const input of ['','{','"x','"\\u12','1e','[true'])
            expect(() => new Parser({memoryMode,strictEnd:false}).end(input)).toThrow(SyntaxError);
    });
    test(Parser.name + ' ' + memoryMode + ' reset preserves subscriptions without carrying the discarded tail', () => {
        const parser = new Parser({memoryMode,strictEnd:false,collectJson:true}), values: unknown[]=[];
        parser.onValue('$', v=>values.push(v));
        expect(parser.write('{}junk')).toBe(4); parser.reset(); expect(parser.json).toBe('');
        expect(parser.write('[]next')).toBe(4); parser.reset(); parser.end('42');
        expect(values).toEqual([{},[],42]); expect(parser.json).toBe('42');
    });
}
test('JSON5 non-strict trailers belong to the manager, strict trailers still validate comments', () => {
    const parser = new Json5Parser({strictEnd:false});
    expect(parser.write("{a:'😀'}/*unclosed")).toBe('/*unclosed'.length); parser.end();
    const strict = new Json5Parser(); strict.write('{a:1}/*'); expect(()=>strict.end()).toThrow(SyntaxError);
    new Json5Parser().end('{a:1}/*ok*/');
});
test('tail count remains correct after unselected subtrees and string fragment delivery', () => {
    const document = JSON.stringify({skip:{deep:[{x:'😀\\\n'.repeat(20)}]},text:'π😀',keep:42});
    for (let cut=0;cut<=document.length;++cut) {
        const parser = new JsonParser({strictEnd:false}), values: unknown[]=[]; let text='';
        parser.onValue('$.keep',v=>values.push(v)); parser.onString('$.text',v=>text+=v);
        expect(parser.write(document.slice(0,cut))).toBe(0);
        if (!parser.rootReady) expect(parser.write(document.slice(cut)+' tail')).toBe(5);
        parser.end(); expect(values).toEqual([42]);expect(text).toBe('π😀');
    }
});
test('managers own their boundary policy independent of supplied core options', () => {
    const lines = new JsonLinesParser({strictEnd:false}); expect(()=>{lines.write('{}[]\n');lines.end();}).toThrow(SyntaxError);
    const prefix = new PrefixedJsonParser('@',{strictEnd:true}); const values: unknown[]=[];
    prefix.onValue([Any],v=>values.push(v)); prefix.write('@[1]junk@[2]'); prefix.end();
    expect(values).toEqual([1,2]); expect(prefix.recordCount).toBe(2);
});
test('invalid strictEnd values fail eagerly', () => {
    expect(()=>new JsonParser({strictEnd:0 as unknown as boolean})).toThrow(TypeError);
});

test('internal cursor collects only the document and returns tail relative to the original input', () => {
    const parser = new JsonParser({strictEnd:false,collectJson:true}), values: unknown[]=[];
    parser.onValue('$',v=>values.push(v));
    const input='noise:{"id":1} tail {"id":2} last';
    expect(parser[DOCUMENT_INPUT](input,6)).toBe(' tail {"id":2} last'.length);
    expect(parser.json).toBe('{"id":1}'); parser.reset();
    const at=input.indexOf('{"id":2}');
    expect(parser[DOCUMENT_INPUT](input,at)).toBe(' last'.length);
    expect(parser.json).toBe('{"id":2}'); parser.end();
    expect(values).toEqual([{id:1},{id:2}]);
});
test('non-strict cancellation and reentry preserve the parser lifecycle', () => {
    const errors:unknown[]=[], parser=new JsonParser({strictEnd:false,onObserverError:e=>errors.push(e)});
    parser.onValue('$',()=>parser.end('x'));
    expect(parser.write('{} tail')).toBe(5);expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toMatch(/re-entered/);parser.end();
    const stopped=new JsonParser({strictEnd:false});stopped.onValue('$',()=>stopped.destroy());
    expect(stopped.write('{} tail')).toBe(0);expect(stopped.rootReady).toBe(false);
    expect(stopped.finished).toBe(false);expect(stopped.closed).toBe(true);
});

for (const Parser of [JsonParser, Json5Parser]) test(Parser.name + ' compact tracking preserves managed tails and original input offsets', () => {
    const document = JSON.stringify({skip:'x'.repeat(70000),label:'π😀'}), suffix = ' tail😀';
    const parser = new Parser({strictEnd:false,memoryMode:'compact',collectJson:true});
    const values: unknown[] = []; let text = '';
    parser.onValue('$.label',(v,path)=>values.push([v,path]));
    parser.onString('$.label',v=>text+=v);
    expect(parser.write(document+suffix)).toBe(suffix.length);
    expect(parser.json).toBe(document); expect(text).toBe('π😀');
    expect(() => parser.write('')).toThrow(/reset/); parser.reset();
    const input = 'noise:' + document + suffix;
    expect(parser[DOCUMENT_INPUT](input,6)).toBe(suffix.length);
    expect(parser.json).toBe(document); expect(parser.end()).toBe(0);
    expect(values).toEqual([['π😀',['label']],['π😀',['label']]]);
    const final = new Parser({strictEnd:false,memoryMode:'compact'});
    expect(final.end(document+suffix)).toBe(suffix.length);
    expect(final.finished).toBe(true);
});

for (const Parser of [JsonParser, Json5Parser]) for (const memoryMode of ['fast', 'compact'] as const)
    for (const strictEnd of [true, false]) {
        test(`${Parser.name} ${memoryMode} strict=${strictEnd} public write ignores forEach arguments`, () => {
            const parser = new Parser({memoryMode, strictEnd, collectJson: true});
            let value: unknown;
            parser.onValue('$', v => value = v);
            ['{"a":', '[10,20]}'].forEach(parser.write, parser);
            parser.end();
            expect(value).toEqual({a: [10,20]});
            expect(parser.json).toBe('{"a":[10,20]}');
        });
    }

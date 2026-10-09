const capturedValues=new WeakMap();
const captureRoot=parser=>{parser.onValue('$',value=>capturedValues.set(parser,value));return parser;};
const capturedRoot=parser=>parser.rootReady?capturedValues.get(parser):undefined;
const {deepStrictEqual,strictEqual,throws}=require('node:assert');
const name=process.argv[2];
const {JsonParser,Json5Parser,Any,compileJsonPath}=require(name??'../dist/cjs/index.js');
const {JsonStream}=require(name?name+'/node':'../dist/cjs/node.js');
(async()=>{
 for(const Parser of [JsonParser,Json5Parser]){const p=new Parser({}),values=[];const first=p.getValue(['items',0]);p.onValue(['items',Any],(v,path)=>values.push([v,path]));p.write('{"items":[1,2]}');p.end();strictEqual(await first,1);deepStrictEqual(values,[[1,['items',0]],[2,['items',1]]]);strictEqual(p.finished,true);}
 const p=captureRoot(new Json5Parser());p.write("{a:'b',n:0x10,}");p.end();deepStrictEqual(capturedRoot(p),{a:'b',n:16});throws(()=>compileJsonPath('$[0:2]'));
 const esm=await import(name??new URL('../dist/esm/index.js',require('node:url').pathToFileURL(__filename)).href);strictEqual(esm.Any,Any);const mixed=captureRoot(new JsonParser());mixed.onValue([esm.Any],()=>{});mixed.write('[1]');mixed.end();
 const s=new JsonStream();const first=s.getValue(['x']);s.end('{"x":1}');strictEqual(await first,1);
 console.log('PASS: CommonJS core and Node exports');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Multi-document wrappers are part of the installed-package gate.
const {JsonLinesParser,PrefixedJsonParser,PrefixFilter}=require(name??'../dist/cjs/index.js');
for(const manager of [new JsonLinesParser(),new PrefixedJsonParser('data:')]) {
 const roots=[];manager.onRecord((v,index)=>roots.push([v,index]));manager.write(manager instanceof JsonLinesParser?'1\n2':'data:1 data:2');manager.end();deepStrictEqual(roots,[[1,0],[2,1]]);
}
const filtered=captureRoot(new JsonParser());const filter=new PrefixFilter(filtered,'BEGIN');filter.write('noiseBEGIN{}');filter.end();deepStrictEqual(capturedRoot(filtered),{});
console.log('PASS: CommonJS multi-document managers and prefix filter');

const reuse=captureRoot(new JsonParser());const reusedValues=[];reuse.onValue([],v=>reusedValues.push(v));reuse.write('1');reuse.reset();reuse.write('2');reuse.end();deepStrictEqual(reusedValues,[1,2]);

throws(()=>new JsonLinesParser().write(Uint8Array.of(0xff)));

const escapeStress={s:'x'.repeat(96)+'\\\n\t"😀'.repeat(200)};
const stressParser=captureRoot(new JsonParser());let stressText='';stressParser.onString(['s'],v=>stressText+=v);
const stressInput=JSON.stringify(escapeStress);for(let pos=0;pos<stressInput.length;pos+=512)stressParser.write(stressInput.slice(pos,pos+512));stressParser.end();deepStrictEqual(capturedRoot(stressParser),escapeStress);strictEqual(stressText,escapeStress.s);
console.log('PASS: complete escape runs and streaming fragments');

// Alternating sibling container types must preserve previously emitted roots.
for(const Parser of [JsonParser,Json5Parser]) {
 const tree={items:[{a:[1,{b:2}]},[],{c:{d:[]}},[{},null,false]],last:{}};
 const reuse=captureRoot(new Parser());reuse.write(JSON.stringify(tree));const first=capturedRoot(reuse);reuse.reset();
 reuse.write('[{},[1,2],{"next":true},[]]');reuse.end();
 deepStrictEqual(first,tree);deepStrictEqual(capturedRoot(reuse),[{},[1,2],{next:true},[]]);
}

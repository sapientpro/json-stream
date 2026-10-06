import {performance} from 'node:perf_hooks';
import {deepStrictEqual, strictEqual} from 'node:assert';
const job=JSON.parse(process.argv[2]);
const api=await import(job.module);
const Parser=job.format==='json5'?api.Json5Parser:api.JsonParser;
const objects=()=>({items:Array.from({length:8000},(_,id)=>({id,name:'item-'+id,active:id%3===0,tags:['a','b'],score:id/7}))});
const fixtures={
 integers:()=>Array.from({length:40000},(_,i)=>i),
 decimals:()=>Array.from({length:40000},(_,i)=>(i-20000)/7),
 exponents:()=>Array.from({length:40000},(_,i)=>i%2?i*1e-120:i*1e120),
 'short strings':()=>Array.from({length:40000},(_,i)=>'s'+i),
 literals:()=>Array.from({length:40000},(_,i)=>[true,false,null][i%3]),
 objects,
 'wide object':()=>Object.fromEntries(Array.from({length:16000},(_,i)=>['key'+i,{id:i,text:'v'+i}])),
 unicode:()=>({text:'€😀漢字'.repeat(30000)}),
 escapes:()=>({text:'\\\n\t"😀'.repeat(20000)}),
 'long string':()=>({text:'abcdef0123456789'.repeat(40000)}),
 small:()=>({items:[{id:1,text:'a'},{id:2,text:'b'}]}),
};
const value=fixtures[job.dataset]();
let text=JSON.stringify(value);
if(job.syntax==='json5')text='/*document*/'+text.replace(/"(items|id|name|active|tags|score|text)":/g,'$1:').replace(/\}$/,' ,}');
const bytes=new TextEncoder().encode(text),input=job.input==='text'?text:bytes,chunks=[];
for(let i=0;i<input.length;i+=job.size)chunks.push(input.slice(i,i+job.size));
const expectedIds=value.items?.map(x=>x.id), expectedValues=Array.isArray(value)?value:value.items;
const run=(capture=false)=>{
 const p=new Parser({retainRoot:job.mode==='root'||job.mode==='root+ids'});
 let count=0,sum=0,length=0,pathSum=0,lastPath,sub,receivedRoot;const values=[];
 const consume=(v,path)=>{++count;for(const key of path)pathSum+=typeof key==='number'?key:key.length;lastPath=path;if(typeof v==='number')sum+=v;else if(typeof v==='string')length+=v.length;else if(v?.id!==undefined)sum+=v.id;if(capture)values.push(v);if(job.mode==='cancel'&&count===32)sub.unsubscribe();};
 const add=path=>job.legacy?p.observe(path).subscribe(({value,path})=>consume(value,path)):p.onValue(path,consume);
 if(job.mode==='root-callback') {const consumeRoot=(v,path)=>{receivedRoot=v;consume(v,path);};if(job.legacy)p.observe([]).subscribe(({value,path})=>consumeRoot(value,path));else p.onValue([],consumeRoot);}
 else if(['scalar','cancel'].includes(job.mode))sub=add([api.Any]);
 else if(['ids','root+ids'].includes(job.mode))add(['items',api.Any,'id']);
 else if(job.mode==='items')add(['items',api.Any]);
 else if(job.mode==='fanout')for(let i=0;i<8;i++)add(['items',api.Any]);
 else if(job.mode==='missing')for(let i=0;i<100;i++)add(['never'+i,api.Any,'id']);
 else if(job.mode==='overlap'){add([api.Rest]);add(['items',api.Any,'id']);add(['items',api.Any]);}
 else if(job.mode==='string'){if(job.legacy)p.chunks('text').subscribe(v=>consume(v,['text']));else p.onString(['text'],consume);}
 for(const chunk of chunks)p.write(chunk);p.end();strictEqual(p.finished,true);
 return{root:job.mode==='root-callback'?receivedRoot:p.root,count,sum,length,pathSum,lastPath,values};
};
const probe=run(true);
if(['root','root+ids','root-callback'].includes(job.mode))deepStrictEqual(probe.root,value);
if(job.mode==='scalar')deepStrictEqual(probe.values,expectedValues);
if(job.mode==='ids')deepStrictEqual(probe.values,expectedIds);
if(job.mode==='items')deepStrictEqual(probe.values,value.items);
if(job.mode==='string')strictEqual(probe.values.join(''),value.text);
if(job.mode==='missing')strictEqual(probe.count,0);
if(job.mode==='cancel')strictEqual(probe.count,32);
const summary=({root,count,sum,length,pathSum,lastPath})=>({root,count,sum,length,pathSum,lastPath});
const expected=summary(probe);
for(let i=0;i<job.warmups;i++)run();
const samples=[];
for(let sample=0;sample<7;sample++){if(typeof Bun!=='undefined')Bun.gc(true);else globalThis.gc?.();const start=performance.now();let result;for(let i=0;i<job.iterations;i++)result=run();samples.push((performance.now()-start)/job.iterations);deepStrictEqual(summary(result),expected);}
const medianMs=[...samples].sort((a,b)=>a-b)[3];
console.log(JSON.stringify({...job,bytes:bytes.length,medianMs,mbps:bytes.length/medianMs/1000,samplesMs:samples}));

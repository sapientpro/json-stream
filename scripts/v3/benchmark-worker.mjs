import {performance} from 'node:perf_hooks';
import {deepStrictEqual, strictEqual} from 'node:assert';
const job=JSON.parse(process.argv[2]);
const gcMode=job.gc??'natural';
if(!['natural','forced'].includes(gcMode))throw new Error('gc must be natural or forced');
const collect=typeof Bun!=='undefined'?()=>Bun.gc(true):globalThis.gc;
if(gcMode==='forced'&&typeof collect!=='function')throw new Error('Forced GC is unavailable; Node needs --expose-gc');
const api=await import(job.module);
const Parser=job.format==='json5'?api.Json5Parser:api.JsonParser;
const objects=()=>({items:Array.from({length:8000},(_,id)=>({id,name:'item-'+id,active:id%3===0,tags:['a','b'],score:id/7}))});
const fixtures={
 scalar:()=>123,
 empty:()=>({}),
 integers:()=>Array.from({length:40000},(_,i)=>i),
 decimals:()=>Array.from({length:40000},(_,i)=>(i-20000)/7),
 exponents:()=>Array.from({length:40000},(_,i)=>i%2?i*1e-120:i*1e120),
 'short escaped strings':()=>Array.from({length:40000},(_,i)=>'\\\n\t"😀'+i),
 'short strings':()=>Array.from({length:40000},(_,i)=>'s'+i),
 literals:()=>Array.from({length:40000},(_,i)=>[true,false,null][i%3]),
 objects,
 'unique identifiers':()=>({items:Array.from({length:8000},(_,id)=>({['key'+id]:id}))}),
 'discarded metadata':()=>({items:Array.from({length:2000},(_,id)=>({id,metadata:Object.fromEntries(
  Array.from({length:6},(_,n)=>['group'+n,{a:id,b:'short',c:false,d:null,e:{x:1,y:2}}])
 )}))}),
 'wide object':()=>Object.fromEntries(Array.from({length:16000},(_,i)=>['key'+i,{id:i,text:'v'+i}])),
 unicode:()=>({text:'€😀漢字'.repeat(30000)}),
 llm:()=>({meta:{model:'fixture',id:1},text:('Пояснення: «так», emoji 😀.\nКод: const x = "value";\nШлях: C:\\tmp\\file.\n').repeat(3000)}),
 escapes:()=>({text:'\\\n\t"😀'.repeat(20000)}),
 'long string':()=>({text:'abcdef0123456789'.repeat(40000)}),
 small:()=>({items:[{id:1,text:'a'},{id:2,text:'b'}]}),
};
const value=fixtures[job.dataset]();
let text=JSON.stringify(value);
if(job.syntax==='json5')text='/*document*/'+text.replace(/"(items|id|name|active|tags|score|text|key[0-9]+)":/g,'$1:').replace(/\}$/,' ,}');
const bytes=new TextEncoder().encode(text),input=job.input==='text'?text:bytes,chunks=[];
if(job.chunkUnit==='codepoint'){
 const points=Array.from(text),encoder=new TextEncoder(),widths=job.chunkPattern??[job.size];
 for(let i=0,n=0;i<points.length;n++){
  const width=widths[n%widths.length],part=points.slice(i,i+width).join('');
  chunks.push(job.input==='text'?part:encoder.encode(part));i+=width;
 }
}else for(let i=0;i<input.length;i+=job.size)chunks.push(input.slice(i,i+job.size));
const expectedIds=value.items?.map(x=>x.id), expectedValues=Array.isArray(value)?value:value.items;
const legacyRetention='root' in Parser.prototype;
const run=(capture=false)=>{
 const retain=job.mode==='root'||job.mode==='root+ids';
 const p=new Parser(legacyRetention?{retainRoot:retain}:{});
 let count=0,sum=0,length=0,pathSum=0,lastPath,sub,receivedRoot;const values=[];
 const consume=(v,path)=>{++count;for(const key of path)pathSum+=typeof key==='number'?key:key.length;lastPath=path;if(typeof v==='number')sum+=v;else if(typeof v==='string')length+=v.length;else if(v?.id!==undefined)sum+=v.id;if(capture)values.push(v);if(job.mode==='cancel'&&count===32)sub.unsubscribe();};
 if(retain&&!legacyRetention)p.onValue('$',v=>receivedRoot=v);
 const add=path=>job.legacy?p.observe(path).subscribe(({value,path})=>consume(value,path)):p.onValue(path,consume);
 if(job.mode==='root-callback') {const consumeRoot=(v,path)=>{receivedRoot=v;consume(v,path);};if(job.legacy)p.observe([]).subscribe(({value,path})=>consumeRoot(value,path));else p.onValue([],consumeRoot);}
 else if(['scalar','cancel'].includes(job.mode))sub=add([api.Any]);
 else if(['ids','root+ids'].includes(job.mode))add(['items',api.Any,'id']);
 else if(job.mode==='items')add(['items',api.Any]);
 else if(job.mode==='fanout')for(let i=0;i<8;i++)add(['items',api.Any]);
 else if(job.mode==='missing')for(let i=0;i<100;i++)add(['never'+i,api.Any,'id']);
 else if(job.mode==='overlap'){add([api.Rest]);add(['items',api.Any,'id']);add(['items',api.Any]);}
 else if(job.mode==='string'){if(job.legacy)p.chunks('text').subscribe(v=>consume(v,['text']));else p.onString(['text'],consume);}
 const input=job.input==='bytes'&&api.createDecodedInput?api.createDecodedInput(p):p;
 for(const chunk of chunks)input.write(chunk);input.end();strictEqual(p.finished,true);
 return{root:job.mode==='root-callback'||!legacyRetention?receivedRoot:p.root,count,sum,length,pathSum,lastPath,values};
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
const samples=[],cpuSamples=[];
for(let sample=0;sample<7;sample++){if(gcMode==='forced')collect();const cpuStart=job.cpu?process.cpuUsage():undefined;const start=performance.now();let result;for(let i=0;i<job.iterations;i++)result=run();samples.push((performance.now()-start)/job.iterations);if(cpuStart){const cpu=process.cpuUsage(cpuStart);cpuSamples.push((cpu.user+cpu.system)/job.iterations/1000);}deepStrictEqual(summary(result),expected);}
const medianMs=[...samples].sort((a,b)=>a-b)[3];
console.log(JSON.stringify({...job,gc:gcMode,bytes:bytes.length,chunkCount:chunks.length,medianMs,mbps:bytes.length/medianMs/1000,millionWritesPerSecond:chunks.length/medianMs/1000,samplesMs:samples,...(job.cpu?{cpuSamplesMs:cpuSamples}:{})}));

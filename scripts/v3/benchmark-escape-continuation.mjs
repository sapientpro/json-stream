import {performance} from 'node:perf_hooks';
import {deepStrictEqual,strictEqual} from 'node:assert';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
// Usage: node|bun scripts/v3/benchmark-escape-continuation.mjs BASELINE_ESM_ENTRY CANDIDATE_ESM_ENTRY [--focus] [--cases=llm:32,hex:32]
const [baseline,candidate]=process.argv.slice(2);
if(!baseline||!candidate)throw new Error('Provide baseline and candidate ESM entry paths');
const {JsonParser:Before}=await import(pathToFileURL(resolve(baseline)).href);
const {JsonParser:After}=await import(pathToFileURL(resolve(candidate)).href);
const fixtures={
 llm:{text:('Текст 😀: "value", C:\\tmp\\file.\n').repeat(800)},
 ascii:{text:'abcdef012345'.repeat(2000)},
 unicode:{text:'Привіт 😀漢字'.repeat(2000)},
 dense:{text:'\\\n\t"😀'.repeat(4000)},
 hex:{text:'漢😀'.repeat(8000)},
 objects:{items:Array.from({length:3000},(_,id)=>({id,name:'item'+id,active:true,text:'some text 😀'}))},
 short:Array.from({length:10000},(_,i)=>'s'+i),
};
const cases=[];
for(const name of ['llm','ascii','unicode','dense','hex'])for(const size of [32,128,65536])cases.push({name,size,mode:'string'});
for(const name of ['objects','short'])cases.push({name,size:65536,mode:'root'});
const median=x=>[...x].sort((a,b)=>a-b)[x.length>>1];
const focus=process.argv.includes('--focus');
const selected=process.argv.find(arg=>arg.startsWith('--cases='))?.slice(8).split(',');
if(selected)for(let i=cases.length-1;i>=0;i--)if(!selected.includes(cases[i].name+':'+cases[i].size))cases.splice(i,1);
if(focus&&!selected)for(let i=cases.length-1;i>=0;i--)if(!((cases[i].name==='llm'&&[32,65536].includes(cases[i].size))||(cases[i].name==='dense'&&cases[i].size===65536)||(cases[i].name==='hex'&&cases[i].size===32)))cases.splice(i,1);
if(!cases.length)throw new Error('No benchmark cases selected');
const results=[];
for(const c of cases){
 const expected=fixtures[c.name];
 let text=JSON.stringify(expected);
 if(c.name==='hex')text=text.replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
 const chunks=[];for(let i=0;i<text.length;i+=c.size)chunks.push(text.slice(i,i+c.size));
 // Keep construction and write call sites separate: a shared runner mixes V8 feedback
 // from both library versions. Two closures from one factory still share function metadata.
 const runBefore=(check=false)=>{const p=new Before();let root,length=0,parts=check?[]:undefined;
 if(c.mode==='root')p.onValue('$',v=>root=v);else p.onString('$.text',v=>{length+=v.length;parts?.push(v);});
 for(const chunk of chunks)p.write(chunk);p.end();
 if(check){if(c.mode==='root')deepStrictEqual(root,expected);else strictEqual(parts.join(''),expected.text);}
 return length;
 };
 const runAfter=(check=false)=>{const p=new After();let root,length=0,parts=check?[]:undefined;
 if(c.mode==='root')p.onValue('$',v=>root=v);else p.onString('$.text',v=>{length+=v.length;parts?.push(v);});
 for(const chunk of chunks)p.write(chunk);p.end();
 if(check){if(c.mode==='root')deepStrictEqual(root,expected);else strictEqual(parts.join(''),expected.text);}
 return length;
 };
 runBefore(true);runAfter(true);
 const warmEnd=performance.now()+(focus?2000:500);while(performance.now()<warmEnd){runBefore();runAfter();}
 const sample=run=>{let n=0;const cpu=process.cpuUsage(),start=performance.now();do{run();n++;}while(performance.now()-start<(focus?50:20));const elapsed=performance.now()-start,usage=process.cpuUsage(cpu);return {wall:elapsed/n,cpu:(usage.user+usage.system)/1000/n};};
 const before=[],after=[],bcpu=[],acpu=[];
 for(let n=0;n<(focus?11:9);n++){let b,a;if(n%2){a=sample(runAfter);b=sample(runBefore);}else{b=sample(runBefore);a=sample(runAfter);}before.push(b.wall);after.push(a.wall);bcpu.push(b.cpu);acpu.push(a.cpu);}
 const b=median(before),a=median(after);
 results.push({...c,bytes:Buffer.byteLength(text),beforeMs:b,afterMs:a,speedup:(b/a-1)*100,beforeCpu:median(bcpu),afterCpu:median(acpu),before,after});
}
console.log(JSON.stringify({runtime:typeof Bun==='undefined'?process.version:'Bun '+Bun.version,results}));

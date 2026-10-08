import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {strictEqual} from 'node:assert';
const [input='text',lifecycle='end',module='dist/esm/v3/index.js']=process.argv.slice(2);
const {JsonParser,createDecodedInput}=await import(pathToFileURL(path.resolve(module)));
const gc=typeof Bun==='undefined'?globalThis.gc:()=>Bun.gc(true);
if(!gc)throw Error('diagnostic requires exposed GC');
const collect=async()=>{for(let n=0;n<3;n++){await new Promise(r=>setTimeout(r,0));gc();}return process.memoryUsage();};
const before=await collect(),parsers=[],values=[];
function add(i){const p=new JsonParser(),transport=createDecodedInput(p);p.onValue('$.keep',v=>values.push(v));const large='π'.repeat(8*1024*1024);
 let text='{"skip":{"text":"'+large+'"},"keep":'+i+'}';
 if(lifecycle==='destroy')text=text.slice(0,-32);
 if(lifecycle==='error')text='{"skip":{"text":"'+large+'\\q"}}';
 try{transport.write(input==='bytes'?new TextEncoder().encode(text):text);if(lifecycle==='end')transport.end();else if(lifecycle==='reset')p.reset();else if(lifecycle==='destroy')p.destroy();}
 catch(e){if(lifecycle!=='error'||!(e instanceof SyntaxError))throw e;}
 parsers.push(p);
}
for(let n=0;n<4;n++)add(n);
strictEqual(values.length,lifecycle==='error'||lifecycle==='destroy'?0:4);
const after=await collect();const retainedMiB=Object.fromEntries(Object.keys(before).map(k=>[k,(after[k]-before[k])/1048576]));
console.log(JSON.stringify({engine:typeof Bun==='undefined'?'node':'bun',input,lifecycle,retainedMiB,parsers:parsers.length,values:values.length}));
if(retainedMiB.heapUsed>1||retainedMiB.external>1)throw Error('large input retained after lifecycle');

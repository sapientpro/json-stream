import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2);
const option=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
const engine=option('--engine','node'),baseline=option('--baseline'),output=option('--output',`notes/analysis/v3-benchmark-${engine}.json`);
const bin=option('--runtime',engine==='bun'?'bun':engine==='deno'?'deno':process.execPath);
const module=pathToFileURL(path.resolve('dist/esm/v3/index.js')).href;
const selectedFormat=option('--format','json');
if(!['json','json5'].includes(selectedFormat))throw new Error('--format must be json or json5');
const versions=baseline?[{label:option('--baseline-label','2.0.1'),module:pathToFileURL(path.resolve(baseline)).href,legacy:option('--baseline-api','observable')==='observable',format:selectedFormat},{label:`3.0 ${selectedFormat.toUpperCase()}`,module,format:selectedFormat}]:[{label:'3.0 JSON',module,format:'json'},{label:'3.0 JSON5',module,format:'json5'}];
let cases=[['integers','root'],['integers','scalar'],['decimals','root'],['decimals','scalar'],['exponents','scalar'],['short strings','root'],['short strings','scalar'],['short escaped strings','scalar'],['literals','scalar'],['objects','root'],['objects','root-callback'],['objects','root+ids'],['objects','ids'],['objects','items'],['objects','fanout'],['objects','overlap'],['objects','missing'],['integers','cancel'],['wide object','root'],['unicode','string'],['escapes','string'],['llm','string'],['long string','root'],['small','root'],['scalar','root'],['empty','root']];
if(option('--cases')){const chosen=new Set(option('--cases').split(','));cases=cases.filter(([data,mode])=>chosen.has(data+'/'+mode));if(!cases.length)throw new Error('No workload matched --cases');}
if(option('--format')){versions.splice(0,versions.length,...versions.filter(v=>v.format===option('--format')));}
const repetitions=Number(option('--pairs','3')),warmups=Number(option('--warmups','120')),iterations=Number(option('--iterations','16'));
const gc=option('--gc','natural');
if(!['natural','forced'].includes(gc))throw new Error('--gc must be natural or forced');
if(gc==='forced'&&engine==='deno')throw new Error('--gc forced is supported by Node and Bun; use --gc natural for Deno');
const chunkUnit=option('--chunk-unit','input');
if(!['input','codepoint'].includes(chunkUnit))throw new Error('--chunk-unit must be input or codepoint');
const chunkPattern=option('--chunk-pattern')?.split(',').map(Number);
if(chunkPattern&&(chunkUnit!=='codepoint'||chunkPattern.some(n=>!Number.isSafeInteger(n)||n<1)))throw new Error('--chunk-pattern needs positive code-point lengths and --chunk-unit codepoint');
const results=[],worker=fileURLToPath(new URL('benchmark-worker.mjs',import.meta.url));
const sizes=chunkPattern?[0]:option('--sizes','1024,65536').split(',').map(Number);
if(!chunkPattern&&sizes.some(n=>!Number.isSafeInteger(n)||n<1))throw new Error('--sizes needs positive integer lengths');
fs.mkdirSync(path.dirname(output),{recursive:true});
for(let repetition=0;repetition<repetitions;repetition++)for(const size of sizes)for(const [dataset,mode] of cases)for(const version of repetition%2?[...versions].reverse():versions){
 const job={...version,dataset,mode,size,repetition,warmups,iterations,gc,input:option('--input','bytes'),syntax:option('--syntax','json'),chunkUnit,chunkPattern};
 const cmdArgs=engine==='deno'?['run','--cached-only','--allow-read',worker,JSON.stringify(job)]:[...(engine==='node'&&gc==='forced'?['--expose-gc']:[]),worker,JSON.stringify(job)];
 const result=JSON.parse(execFileSync(bin,cmdArgs,{encoding:'utf8',timeout:180000,env:engine==='deno'?{...process.env,DENO_DIR:'/private/tmp/json-stream-deno-v3-cache'}:process.env}));
 results.push(result);fs.writeFileSync(output,JSON.stringify({engine,runtime:execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),protocol:{repetitions,warmups,iterations,samples:7,gc,setupIncluded:true,ownedConcretePathsConsumed:true,serialWorkers:true,units:'decimal MB/s'},results},null,2));
 const chunkLabel=chunkPattern?`pattern ${chunkPattern.join(',')} code points`:chunkUnit==='codepoint'?`${size} code points`:`${size} ${job.input==='text'?'UTF-16 units':'bytes'}`;
 console.log(`${results.length}/${repetitions*sizes.length*cases.length*versions.length} ${version.label} ${dataset}/${mode} ${chunkLabel}: ${result.mbps.toFixed(1)} MB/s`);
}

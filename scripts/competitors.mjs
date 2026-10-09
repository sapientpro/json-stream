// Broad public-API comparison. Throughput uses natural GC only, in serial fresh workers.
import {Buffer} from 'node:buffer';
import {performance} from 'node:perf_hooks';
import {deepStrictEqual, strictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {cpus} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createDecodedInput,JsonParser, Any} from '../dist/esm/index.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const packages=['sapient','streamparser','stream-json','json-web-streams'];
const names={sapient:'@sapientpro/json-stream',streamparser:'@streamparser/json','stream-json':'stream-json','json-web-streams':'json-web-streams'};
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
function fixture(name) {
  let value, text;
  switch (name) {
    case 'llm': value = {text: ('Пояснення 😀.\nКод: const x = \"value\"; C:\\tmp\\file\n').repeat(1000)}; break;
    case 'ascii': value = {text: 'x'.repeat(1024 * 1024)}; break;
    case 'unicode': value = {text: 'Привіт 世界 😀🎉 '.repeat(24000)}; break;
    case 'escapes': text = '{"text":"' + 'a\\n\\t\\\"\\\\\\u0414\\uD83D\\uDE00'.repeat(15000) + '"}'; break;
    case 'numbers': value = Array.from({length: 50000}, (_, i) => i - 25000); break;
    case 'decimals': text = '[' + Array.from({length: 30000}, (_, i) => `${i % 2 ? '-' : ''}${i + 1}.125e-3`).join(',') + ']'; break;
    case 'literals': value = Array.from({length: 90000}, (_, i) => [true, false, null][i % 3]); break;
    case 'short strings': value = Array.from({length: 40000}, (_, i) => `str-${i}`); break;
    case 'wide': value = Object.fromEntries(Array.from({length: 15000}, (_, i) => [`key${i}`, i])); break;
    case 'empty': value = Array.from({length: 30000}, (_, i) => i % 2 ? {} : []); break;
    case 'nested': {
      let inner = {leaf: 'done'};
      for (let i = 0; i < 128; i++) inner = [inner];
      value = Array.from({length: 200}, () => inner); break;
    }
    case 'tiny': value = {ok: true, user: {name: 'Alice'}, tags: [1, 2]}; break;
    case 'probe-surrogates': text = '{"text":"\\uD83D\\uDE00"}'; break;
    case 'probe-slash': text = '{"text":"a\\/b"}'; break;
    case 'probe-unicode': value = {text: 'a'.repeat(1023) + '😀end'}; break;
    default: value = {items: Array.from({length: 8000}, (_, i) => ({id: i, name: `item-${i}`, active: i % 2 === 0,
      price: i / 8, tags: ['red', 'blue'], metadata: {city: 'Київ', note: null}}))};
  }
  text ??= JSON.stringify(value);
  value ??= JSON.parse(text);
  return {text, value, bytes: Buffer.from(text)};
}

// Async and synchronous adapters consume identical prepared chunks.
function webSource(chunks) {
  let index = 0;
  return new ReadableStream({pull(controller) {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  }});
}

async function adapter(id, mode, bytes, capture = false) {
  if (id === 'sapient') return async chunks => {
    const parser = new JsonParser();
    let value;
    if(mode === 'root') parser.onValue('$', v => value=v);
    let count = 0, sum = 0, length = 0;
    const parts = [];
    if (mode === 'items') parser.onValue(['items', Any], (value, path) => {count++; sum += value.id; if(capture) parts.push(value);});
    if (mode === 'string') parser.onString('$.text', part => { length += part.length; if (capture) parts.push(part); });
    const input=createDecodedInput(parser);
    for (const chunk of chunks) input.write(chunk);
    input.end();
    return {value, selected: capture && mode==='items' ? parts : undefined, count, sum, length, decoded: capture ? parts.join('') : undefined, holder: parser};
  };
  if (id === 'streamparser') {
    const {JSONParser} = await import('@streamparser/json');
    return async chunks => {
      const parser = new JSONParser({paths: [mode === 'items' ? '$.items.*' : mode === 'string' ? '$.text' : '$'],
        keepStack: mode === 'root', emitPartialTokens: mode === 'string', emitPartialValues: mode === 'string'});
      let value, count = 0, sum = 0, length = 0;
      const selected=[];
      parser.onValue = event => {
        if (mode === 'root') value = event.value;
        else if (mode === 'items') {count++; sum += event.value.id; if(capture) selected.push(event.value);}
        // Partial values are cumulative previews, rather than independent chunks.
        else if (typeof event.value === 'string') { length = event.value.length; if (capture) value = event.value; }
      };
      for (const chunk of chunks) parser.write(chunk);
      if (!parser.isEnded) parser.end();
      return {value, selected, count, sum, length, decoded: value, holder: parser};
    };
  }
  if (id === 'stream-json') {
    const [{jsonParser: tokenize}, {default: Assembler}, {default: pick}, {default: streamArray}, defs] = await Promise.all([
      import('stream-json/core/parser.js'), import('stream-json/core/assembler.js'),
      import('stream-json/core/filters/pick.js'), import('stream-json/core/streamers/stream-array.js'), import('stream-chain/defs.js')]);
    const each = (output, fn) => {
      if (output === defs.none) return;
      if (defs.isMany(output)) { for (const token of defs.getManyValues(output)) fn(token); }
      else fn(output);
    };
    return async chunks => {
      const parser = tokenize(mode === 'string'
        ? {packStrings: false, streamStrings: true, streamKeys: false, streamNumbers: false}
        : {streamValues: false});
      const asm = mode === 'root' ? new Assembler() : null;
      const select = mode === 'items' ? pick({filter: 'items'}) : null;
      const array = mode === 'items' ? streamArray() : null;
      const decoder = bytes ? new TextDecoder() : null;
      let count = 0, sum = 0, length = 0;
      const parts = [];
      const consume = token => {
        if (asm) { asm[token.name]?.(token.value); }
        else if (select) each(select(token), token => each(array(token), ({value}) => { count++; sum += value.id; if(capture) parts.push(value); }));
        else if (token.name === 'stringChunk') { length += token.value.length; if (capture) parts.push(token.value); }
      };
      for (const chunk of chunks) each(parser(decoder ? decoder.decode(chunk, {stream: true}) : chunk), consume);
      if (decoder) { const tail = decoder.decode(); if (tail) each(parser(tail), consume); }
      each(parser(defs.none), consume);
      // Keep the whole pipeline alive during retained-heap sampling, including
      // selective modes that have no assembler.
      return {value: asm?.current, selected: mode==='items'&&capture?parts:undefined, count, sum, length, decoded: capture ? parts.join('') : undefined,
        holder: {parser, asm, select, array, decoder}};
    };
  }
  if (id === 'json-web-streams') {
    if (mode === 'string') return null;
    const {JSONParseStream} = await import('json-web-streams');
    return async chunks => {
      let input = webSource(chunks);
      if (bytes) input = input.pipeThrough(new TextDecoderStream());
      const stream = input.pipeThrough(new JSONParseStream([mode === 'root' ? '$' : '$.items[*]']));
      let value, count = 0, sum = 0; const selected=[];
      for await (const event of stream) {
        if (mode === 'root') value = event.value;
        else {count++; sum += event.value.id; if(capture) selected.push(event.value);}
      }
      return {value, selected, count, sum, holder: stream};
    };
  }
  throw Error('Unknown package: '+id);
}

async function worker(job) {
 const {id,mode,dataset,size,input}=job;
 const data=fixture(dataset),bytes=input==='bytes',raw=bytes?data.bytes:data.text,chunks=[];
 for(let i=0;i<raw.length;i+=size)chunks.push(bytes?raw.subarray(i,i+size):raw.slice(i,i+size));
 const run=await adapter(id,mode,bytes);
 if(!run)return {...job,status:'unsupported',reason:'No independent decoded string-fragment API'};
 const verify=result=>{
  if(mode==='root')deepStrictEqual(result.value,data.value);
  if(mode==='items'){strictEqual(result.count,data.value.items.length);strictEqual(result.sum,data.value.items.reduce((s,v)=>s+v.id,0));}
  if(mode==='string')strictEqual(result.length,data.value.text.length);
 };
 const probe=await (await adapter(id,mode,bytes,true))(chunks);verify(probe);
 if(mode==='items')deepStrictEqual(probe.selected,data.value.items);
 if(mode==='string')strictEqual(probe.decoded,data.value.text);
 if(job.check)return {...job,status:'ok',bytes:data.bytes.length};
 const iterations=dataset==='tiny'?128:job.iterations,warmups=dataset==='tiny'?512:job.warmups;
 for(let i=0;i<warmups;i++)verify(await run(chunks));
 const timings=[],cpu=[];
 for(let i=0;i<7;i++){
  const cpuStart=process.cpuUsage(),start=performance.now();let result;
  for(let j=0;j<iterations;j++)result=await run(chunks);
  timings.push((performance.now()-start)/iterations);
  const usage=process.cpuUsage(cpuStart);cpu.push((usage.user+usage.system)/iterations/1000);
  verify(result);
 }
 const medianMs=median(timings);
 return {...job,status:'ok',bytes:data.bytes.length,chunkCount:chunks.length,warmups,iterations,samplesMs:timings,cpuSamplesMs:cpu,medianMs,mbps:data.bytes.length/medianMs/1000};
}
if(process.argv[2]==='--worker') {
 const job=JSON.parse(process.argv[3]);
 try{console.log(JSON.stringify(await worker(job)));}
 catch(error){console.log(JSON.stringify({...job,status:'failed',reason:String(error.stack??error).slice(0,1800)}));}
}else{
 const args=process.argv.slice(2),option=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
 const engine=option('--engine','node'),runtime=option('--runtime',engine),checks=args.includes('--checks');
 const repetitions=Number(option('--pairs',checks?'1':'3')),warmups=Number(option('--warmups','12')),iterations=Number(option('--iterations','4'));
 if(!['node','bun','deno'].includes(engine))throw Error('Unsupported engine');
 if([repetitions,warmups,iterations].some(n=>!Number.isSafeInteger(n)||n<1))throw Error('Counts must be positive integers');
 const cases=[];const add=(dataset,mode,size,input)=>cases.push({dataset,mode,size,input});
 if(checks){for(const dataset of ['probe-surrogates','probe-slash','probe-unicode'])for(const mode of ['root','string'])for(const input of ['text','bytes'])add(dataset,mode,1,input);}
 else if(args.includes('--secondary')){
  for(const dataset of ['numbers','objects','unicode'])add(dataset,'root',1024,'bytes');
  add('objects','items',65536,'bytes');for(const input of ['text','bytes'])add('llm','string',128,input);
 }else{
  for(const dataset of ['ascii','unicode','escapes','numbers','decimals','literals','short strings','wide','empty','nested','tiny','objects'])for(const input of ['text','bytes'])add(dataset,'root',1024,input);
  for(const dataset of ['unicode','objects'])add(dataset,'root',65536,'bytes');
  for(const size of [1024,65536]){add('objects','items',size,'bytes');for(const dataset of ['ascii','unicode','escapes'])add(dataset,'string',size,'bytes');}
  for(const size of [16,128])for(const input of ['text','bytes'])add('llm','string',size,input);
 }
 const chosen=option('--cases');const selected=chosen?cases.filter(x=>chosen.split(',').includes(x.dataset+'/'+x.mode)):cases;
 if(!selected.length)throw Error('No matching cases');
 const versions=Object.fromEntries(packages.map(id=>[id,JSON.parse(readFileSync(path.join(root,id==='sapient'?'package.json':`node_modules/${names[id]}/package.json`),'utf8')).version]));
 const output=option('--output',`benchmarks/results/v3-competitors-${engine}${checks?'-checks':''}.json`);mkdirSync(path.dirname(output),{recursive:true});
 let sourceRevision;try{sourceRevision=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{sourceRevision='unavailable';}
 const results=[],total=selected.length*packages.length*repetitions;
 for(let repetition=0;repetition<repetitions;repetition++)for(const c of selected)for(const id of [...packages.slice(repetition%4),...packages.slice(0,repetition%4)]){
  const job={...c,id,repetition,warmups,iterations,check:checks};let result;
  const flags=engine==='deno'?['run','--cached-only','--allow-read','--allow-env','--allow-sys']:[];
  try{result=JSON.parse(execFileSync(runtime,[...flags,fileURLToPath(import.meta.url),'--worker',JSON.stringify(job)],{cwd:root,encoding:'utf8',timeout:120000}));}
  catch(error){result={...job,status:'failed',reason:String(error).slice(0,1500)};}
  results.push(result);writeFileSync(output,JSON.stringify({date:new Date().toISOString(),engine,sourceRevision,runtime:execFileSync(runtime,['--version'],{encoding:'utf8'}).trim(),cpu:cpus()[0]?.model,versions,protocol:{gc:'natural',serialWorkers:true,repetitions,warmups,iterations,samples:7,unit:'decimal MB/s',setupIncluded:true,checks,notes:'Streamparser strings are cumulative previews; stream-json uses public synchronous core; json-web-streams includes Web scheduling and UTF-8 decoding.'},results},null,2)+'\n');
  console.log(`${results.length}/${total} ${id} ${c.dataset}/${c.mode} ${c.input}/${c.size}: ${result.status}${result.mbps?' '+result.mbps.toFixed(1)+' MB/s':''}`);
 }
 if(checks&&results.some(r=>r.status==='failed'))process.exitCode=1;
}

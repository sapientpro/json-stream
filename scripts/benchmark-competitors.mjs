import {performance} from 'node:perf_hooks';
import {deepStrictEqual, strictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {cpus} from 'node:os';
import {fileURLToPath} from 'node:url';
import {JsonParser, Any} from '../dist/esm/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`;
const engine = typeof Bun !== 'undefined' ? 'bun' : 'node';
const gc = typeof Bun !== 'undefined' ? () => Bun.gc(true) : globalThis.gc;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const packages = ['sapient', 'streamparser', 'stream-json', 'json-web-streams', 'json-stream-lite'];
const names = {sapient: '@sapientpro/json-stream', streamparser: '@streamparser/json',
  'stream-json': 'stream-json', 'json-web-streams': 'json-web-streams', 'json-stream-lite': 'json-stream-lite'};

function fixture(name) {
  let value, text;
  switch (name) {
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
    case 'memory': value = {items: Array.from({length: 20000}, (_, i) => ({id: i, text: 'x'.repeat(1024)}))}; break;
    default: value = {items: Array.from({length: 8000}, (_, i) => ({id: i, name: `item-${i}`, active: i % 2 === 0,
      price: i / 8, tags: ['red', 'blue'], metadata: {city: 'Київ', note: null}}))};
  }
  text ??= JSON.stringify(value);
  value ??= JSON.parse(text);
  return {text, value, bytes: Buffer.from(text)};
}

// Pull adapters consume exactly the same prepared chunks as push adapters.
async function* source(chunks) { for (const chunk of chunks) yield chunk; }
function webSource(chunks) {
  let index = 0;
  return new ReadableStream({pull(controller) {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  }});
}

async function adapter(id, mode, bytes, capture = false) {
  if (id === 'sapient') return async chunks => {
    const parser = new JsonParser({retainRoot: mode === 'root'});
    let count = 0, sum = 0, length = 0;
    const parts = [];
    if (mode === 'items') parser.observe(['items', Any]).subscribe(({value}) => { count++; sum += value.id; });
    if (mode === 'string') parser.chunks('text').subscribe(part => { length += part.length; if (capture) parts.push(part); });
    for (const chunk of chunks) parser.write(chunk);
    parser.end();
    return {value: parser.root, count, sum, length, decoded: capture ? parts.join('') : undefined, holder: parser};
  };
  if (id === 'streamparser') {
    const {JSONParser} = await import('@streamparser/json');
    return async chunks => {
      const parser = new JSONParser({paths: [mode === 'items' ? '$.items.*' : mode === 'string' ? '$.text' : '$'],
        keepStack: mode === 'root', emitPartialTokens: mode === 'string', emitPartialValues: mode === 'string'});
      let value, count = 0, sum = 0, length = 0;
      parser.onValue = event => {
        if (mode === 'root') value = event.value;
        else if (mode === 'items') { count++; sum += event.value.id; }
        // Partial values are cumulative previews, rather than independent chunks.
        else if (typeof event.value === 'string') { length = event.value.length; if (capture) value = event.value; }
      };
      for (const chunk of chunks) parser.write(chunk);
      if (!parser.isEnded) parser.end();
      return {value, count, sum, length, decoded: value, holder: parser};
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
        else if (select) each(select(token), token => each(array(token), ({value}) => { count++; sum += value.id; }));
        else if (token.name === 'stringChunk') { length += token.value.length; if (capture) parts.push(token.value); }
      };
      for (const chunk of chunks) each(parser(decoder ? decoder.decode(chunk, {stream: true}) : chunk), consume);
      if (decoder) { const tail = decoder.decode(); if (tail) each(parser(tail), consume); }
      each(parser(defs.none), consume);
      return {value: asm?.current, count, sum, length, decoded: capture ? parts.join('') : undefined, holder: asm};
    };
  }
  if (id === 'json-web-streams') {
    if (mode === 'string') return null;
    const {JSONParseStream} = await import('json-web-streams');
    return async chunks => {
      let input = webSource(chunks);
      if (bytes) input = input.pipeThrough(new TextDecoderStream());
      const stream = input.pipeThrough(new JSONParseStream([mode === 'root' ? '$' : '$.items[*]']));
      let value, count = 0, sum = 0;
      for await (const event of stream) {
        if (mode === 'root') value = event.value;
        else { count++; sum += event.value.id; }
      }
      return {value, count, sum, holder: stream};
    };
  }
  const {JsonValue, JsonObject} = await import('json-stream-lite');
  return async chunks => {
    if (mode === 'root') {
      const parser = new JsonValue(source(chunks));
      const value = await parser.readValueAsync();
      return {value, holder: parser};
    }
    const parser = new JsonObject(source(chunks));
    let count = 0, sum = 0, length = 0;
    const parts = [];
    for await (const member of parser.membersAsync()) {
      const key = await member.key.readAsync();
      if (mode === 'items' && key === 'items') {
        const array = await member.value.readAsync();
        for await (const entity of array.itemsAsync()) { const value = await entity.readValueAsync(); count++; sum += value.id; }
      } else if (mode === 'string' && key === 'text') {
        const string = await member.value.readAsync();
        for await (const part of string.streamAsync(1024)) { length += part.length; if (capture) parts.push(part); }
        // The entity iterator otherwise attempts to consume the streamed string again.
        return {count, sum, length, decoded: capture ? parts.join('') : undefined, holder: parser};
      } else await member.value.consumeAsync();
    }
    return {count, sum, length, decoded: capture ? parts.join('') : undefined, holder: parser};
  };
}

async function worker(job) {
  const {id, mode, dataset, size, input} = job;
  const data = fixture(dataset);
  const bytes = input === 'bytes';
  const raw = bytes ? data.bytes : data.text;
  const chunks = [];
  for (let i = 0; i < raw.length; i += size) chunks.push(bytes ? raw.subarray(i, i + size) : raw.slice(i, i + size));
  const run = id === 'native' ? async () => ({value: JSON.parse(data.text)}) : await adapter(id, mode, bytes);
  if (!run) return {...job, status: 'unsupported', reason: 'No public decoded string-fragment API'};
  const verify = result => {
    if (mode === 'root') deepStrictEqual(result.value, data.value);
    if (mode === 'items') {
      strictEqual(result.count, data.value.items.length);
      strictEqual(result.sum, data.value.items.reduce((sum, value) => sum + value.id, 0));
    }
    if (mode === 'string') strictEqual(result.length, data.value.text.length);
  };
  // Verify decoded fragments themselves once; length alone does not catch corrupt Unicode.
  if (mode === 'string') {
    const probe = await adapter(id, mode, bytes, true);
    strictEqual((await probe(chunks)).decoded, data.value.text);
  }
  if (dataset === 'memory') {
    const measurements = [];
    const measure = async () => {
      gc?.();
      const before = process.memoryUsage().heapUsed;
      const result = await run(chunks);
      verify(result);
      globalThis.__benchmarkRetained = result;
      gc?.();
      const retained = (process.memoryUsage().heapUsed - before) / 1048576;
      globalThis.__benchmarkRetained = null;
      return retained;
    };
    for (let i = 0; i < 3; i++) measurements.push(await measure());
    return {...job, status: 'ok', samplesHeapMiB: measurements, retainedHeapMiB: median(measurements)};
  }
  const warmups = 3, samples = mode === 'memory' ? 3 : 5;
  const iterations = dataset === 'tiny' ? 100 : 1;
  for (let i = 0; i < warmups; i++) verify(await run(chunks));
  const timings = [];
  for (let i = 0; i < samples; i++) {
    gc?.();
    const start = performance.now();
    let result;
    for (let j = 0; j < iterations; j++) result = await run(chunks);
    timings.push((performance.now() - start) / iterations);
    verify(result);
  }
  const ms = median(timings);
  return {...job, status: 'ok', bytes: data.bytes.length, samplesMs: timings, medianMs: ms,
    mibPerSecond: data.bytes.length / 1048576 / (ms / 1000)};
}

if (process.argv[2] === '--worker') {
  const job = JSON.parse(process.argv[3]);
  try { console.log(JSON.stringify(await worker(job))); }
  catch (error) { console.log(JSON.stringify({...job, status: 'failed', reason: String(error.stack ?? error).slice(0, 1800)})); }
} else {
  const jobs = [];
  const checksOnly = process.argv.includes('--checks');
  const rerunStrings = process.argv.includes('--rerun-strings');
  const add = (dataset, mode, size, input, ids = packages) => {
    for (const id of ids) jobs.push({id, dataset, mode, size, input});
  };
  if (checksOnly) {
    for (const dataset of ['probe-surrogates', 'probe-slash', 'probe-unicode']) {
      for (const mode of ['root', 'string']) {
        for (const input of ['string', 'bytes']) add(dataset, mode, 1, input);
      }
    }
  } else {
    for (const dataset of ['ascii', 'unicode', 'escapes', 'numbers', 'decimals', 'literals', 'short strings', 'wide', 'empty', 'nested', 'tiny', 'objects']) {
      add(dataset, 'root', 1024, 'string');
      add(dataset, 'root', 1024, 'bytes');
      add(dataset, 'root', 1e9, 'string', ['native']);
    }
    for (const dataset of ['unicode', 'objects']) {
      for (const size of [16, 65536, 1e9]) add(dataset, 'root', size, 'bytes');
    }
    for (const size of [1024, 65536]) {
      add('objects', 'items', size, 'bytes');
      for (const dataset of ['ascii', 'unicode', 'escapes']) add(dataset, 'string', size, 'bytes');
    }
    add('memory', 'root', 65536, 'bytes');
    add('memory', 'items', 65536, 'bytes');
  }
  const directory = new URL('../benchmarks/results/', import.meta.url);
  const resultFile = new URL(`competitors-${checksOnly ? 'checks-' : ''}${engine}.json`, directory);
  const results = rerunStrings ? JSON.parse(readFileSync(resultFile, 'utf8')).results : [];
  if (rerunStrings) {
    const selected = jobs.filter(job => job.mode === 'string');
    jobs.splice(0, jobs.length, ...selected);
  }
  const versions = Object.fromEntries(packages.map(id => [id, JSON.parse(readFileSync(
    new URL(id === 'sapient' ? '../package.json' : `../node_modules/${names[id]}/package.json`, import.meta.url), 'utf8')).version]));
  mkdirSync(directory, {recursive: true});
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    let result;
    try {
      const args = [...(engine === 'node' ? ['--expose-gc'] : []), fileURLToPath(import.meta.url), '--worker', JSON.stringify(job)];
      result = JSON.parse(execFileSync(process.execPath, args, {cwd: root, encoding: 'utf8', timeout: 45000}));
    } catch (error) { result = {...job, status: 'failed', reason: error.code === 'ETIMEDOUT' ? 'Exceeded 45 seconds per scenario' : String(error).slice(0, 1000)}; }
    const existing = results.findIndex(row => row.id === job.id && row.dataset === job.dataset && row.mode === job.mode && row.size === job.size && row.input === job.input);
    if (existing < 0) results.push(result);
    else results[existing] = result;
    writeFileSync(resultFile, JSON.stringify({runtime, cpu: cpus()[0]?.model,
      date: new Date().toISOString(), versions, warmups: 3, samples: 5, results}, null, 2) + '\n');
    console.log(`${i + 1}/${jobs.length} ${job.id} ${job.dataset} ${job.mode} ${job.input}/${job.size}: ${result.status}${result.medianMs ? ' ' + result.medianMs.toFixed(2) + ' ms' : ''}`);
  }
}

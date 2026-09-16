import {performance} from 'node:perf_hooks';
import {deepStrictEqual, strictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import {cpus, platform, arch} from 'node:os';
import {finished} from 'node:stream/promises';
import {Any, Rest, JsonParser} from '../dist/esm/index.js';
import {JsonStream} from '../dist/esm/node.js';

const isBun = typeof Bun !== 'undefined';
const engine = isBun ? 'bun' : 'node';
const runtime = isBun ? `Bun ${Bun.version}` : `Node ${process.version}`;
const gc = isBun ? () => Bun.gc(true) : globalThis.gc;
const MiB = 1024 * 1024;
const samples = 5;
const warmups = 2;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = value => +value.toFixed(6);
const fixtures = [];
function fixture(name, value, raw = JSON.stringify(value)) {
  const entry = {name, text: raw, value: JSON.parse(raw), bytes: Buffer.from(raw)};
  fixtures.push(entry);
  return entry;
}
const ascii = fixture('ASCII string 1 MiB', {text: 'a'.repeat(MiB)});
const unicode = fixture('Unicode / emoji', {text: 'Привіт 世界 😀🎉 '.repeat(24000)});
const escaped = fixture('Escapes / surrogate pairs', null,
  '{"text":"' + 'line\\n\\t\\\"\\\\\\u0414\\uD83D\\uDE00'.repeat(20000) + '"}');
fixture('Integers', Array.from({length: 50000}, (_, i) => i - 25000));
fixture('Decimals / exponents', null, '[' + Array.from({length: 30000}, (_, i) => `${i % 2 ? '-' : ''}${i + 1}.125e-3`).join(',') + ']');
fixture('Booleans / null', Array.from({length: 90000}, (_, i) => [true, false, null][i % 3]));
const objects = fixture('Mixed objects', {items: Array.from({length: 8000}, (_, i) => ({
  id: i, name: `item-${i}`, active: i % 2 === 0, price: i / 8,
  tags: ['red', 'blue'], metadata: {city: 'Київ', note: null},
}))});
fixture('Wide object / 15000 keys', Object.fromEntries(Array.from({length: 15000}, (_, i) => [`key${i}`, i])));
fixture('Small strings', Array.from({length: 40000}, (_, i) => `str-${i}`));
fixture('Empty containers', Array.from({length: 30000}, (_, i) => i % 2 ? {} : []));
for (const depth of [32, 256]) {
  let nested = {leaf: 'done'};
  for (let i = 0; i < depth; i++) nested = [nested];
  fixture(`Nested arrays / depth ${depth}`, Array.from({length: depth === 32 ? 1000 : 200}, () => nested));
}
const tiny = fixture('Small response', {ok: true, id: 123, user: {name: 'Alice', roles: ['reader']}});

const results = [];
function chunksFor(data, size, bytes = false) {
  const input = bytes ? data.bytes : data.text;
  const chunks = [];
  for (let i = 0; i < input.length; i += size) chunks.push(bytes ? input.subarray(i, i + size) : input.slice(i, i + size));
  return chunks;
}
async function bench(group, data, mode, chunkSize, run, verify, iterations = 1) {
  for (let i = 0; i < warmups; i++) {
    let result;
    for (let j = 0; j < iterations; j++) result = await run();
    verify(result);
  }
  const times = [];
  for (let sample = 0; sample < samples; sample++) {
    gc?.();
    const start = performance.now();
    let result;
    for (let i = 0; i < iterations; i++) result = await run();
    times.push((performance.now() - start) / iterations);
    verify(result);
  }
  const ms = median(times);
  results.push({group, dataset: data.name, bytes: data.bytes.length, mode, chunkSize,
    samplesMs: times.map(round), medianMs: round(ms), minMs: round(Math.min(...times)), maxMs: round(Math.max(...times)),
    mibPerSecond: round(data.bytes.length / MiB / (ms / 1000)), iterations});
}
async function parserBench(group, data, mode, size, {bytes = false, options = {}, setup} = {}) {
  const chunks = chunksFor(data, size, bytes);
  await bench(group, data, mode, size === Infinity ? 'whole' : size, () => {
    const parser = new JsonParser(options);
    const check = setup?.(parser);
    for (const chunk of chunks) parser.write(chunk);
    parser.end();
    return {parser, check};
  }, ({parser, check}) => {
    if (options.retainRoot !== false) deepStrictEqual(parser.root, data.value);
    else strictEqual(parser.root, undefined);
    if (options.collectJson) strictEqual(parser.json, data.text);
    check?.();
  }, data === tiny ? 1000 : 1);
}

console.log(`${runtime}; ${warmups} warmups, ${samples} samples; fixtures and chunk slicing excluded`);
for (const data of fixtures) {
  await bench('Data types', data, 'JSON.parse', 'whole', () => JSON.parse(data.text),
    value => deepStrictEqual(value, data.value), data === tiny ? 1000 : 1);
  await parserBench('Data types', data, 'string input', 1024);
  await parserBench('Data types', data, 'UTF-8 Buffer input', 1024, {bytes: true});
}
console.log('Data types complete');
for (const data of [ascii, unicode, objects]) {
  for (const size of [1, 16, 1024, 65536, Infinity]) {
    await parserBench('Chunk sizes', data, 'string input', size);
    await parserBench('Chunk sizes', data, 'UTF-8 Buffer input', size, {bytes: true});
  }
}
console.log('Chunk sizes complete');
const itemCount = objects.value.items.length;
const idSum = itemCount * (itemCount - 1) / 2;
function observeItems(parser) {
  let count = 0, sum = 0;
  parser.observe(['items', Any]).subscribe(({value}) => { count++; sum += value.id; });
  return () => { strictEqual(count, itemCount); strictEqual(sum, idSum); };
}
function descendants(value) {
  if (value === null || typeof value !== 'object') return 0;
  return Object.values(value).reduce((n, child) => n + 1 + descendants(child), 0);
}
const descendantCount = descendants(objects.value);
await parserBench('Subscriptions', objects, 'none', 1024);
await parserBench('Subscriptions', objects, 'Any items / retain root', 1024, {setup: observeItems});
await parserBench('Subscriptions', objects, 'Any items / discard root', 1024, {options: {retainRoot: false}, setup: observeItems});
await parserBench('Subscriptions', objects, 'Rest / all descendants', 1024, {setup: parser => {
  let count = 0;
  parser.observe([Rest]).subscribe(() => { count++; });
  return () => strictEqual(count, descendantCount);
}});
await parserBench('Subscriptions', objects, '100 exact paths + Any', 1024, {setup: parser => {
  let sum = 0;
  for (let i = 0; i < 100; i++) parser.observe(['items', i, 'id']).subscribe(({value}) => { sum += value; });
  const check = observeItems(parser);
  return () => { strictEqual(sum, 4950); check(); };
}});
await parserBench('Subscriptions', objects, 'collectJson', 1024, {options: {collectJson: true}});
for (const data of [ascii, unicode, escaped]) {
  for (const retainRoot of [true, false]) {
    await parserBench('Subscriptions', data, `chunks / retainRoot=${retainRoot}`, 1024, {
      options: {retainRoot}, setup: parser => {
        let length = 0;
        parser.chunks('text').subscribe(value => { length += value.length; });
        return () => strictEqual(length, data.value.text.length);
      },
    });
  }
}
for (const mib of [2, 4, 8]) {
  const data = {name: `ASCII string ${mib} MiB`, text: JSON.stringify({text: 'x'.repeat(mib * MiB)})};
  data.value = JSON.parse(data.text);
  data.bytes = Buffer.from(data.text);
  await parserBench('String scaling', data, 'chunks / retain root', 1024, {setup: parser => {
    let length = 0;
    parser.chunks('text').subscribe(part => { length += part.length; });
    return () => strictEqual(length, mib * MiB);
  }});
}
console.log('Subscriptions and scaling complete');
const objectChunks = chunksFor(objects, 16384, true);
await parserBench('Transports', objects, 'direct write', 16384, {bytes: true});
await bench('Transports', objects, 'Web WritableStream writer', 16384, async () => {
  const parser = new JsonParser();
  const writer = parser.writable.getWriter();
  for (const chunk of objectChunks) await writer.write(chunk);
  await writer.close();
  return parser.root;
}, root => deepStrictEqual(root, objects.value));
await bench('Transports', objects, 'Node Writable wrapper', 16384, async () => {
  const stream = new JsonStream();
  const result = stream.value();
  const completion = finished(stream);
  for (const chunk of objectChunks) stream.write(chunk);
  stream.end();
  await completion;
  return result;
}, root => deepStrictEqual(root, objects.value));
await bench('Transports', objects, 'async iterator / queued items', 16384, async () => {
  const parser = new JsonParser({retainRoot: false});
  let count = 0, sum = 0;
  const consuming = (async () => {
    for await (const {value} of parser.observe(['items', Any])) { count++; sum += value.id; }
  })();
  for (const chunk of objectChunks) parser.write(chunk);
  parser.end();
  await consuming;
  return {count, sum};
}, result => deepStrictEqual(result, {count: itemCount, sum: idSum}));
const stringChunks = chunksFor(ascii, 1024);
await bench('Transports', ascii, 'ReadableStream / queued chunks', 1024, async () => {
  const parser = new JsonParser({retainRoot: false});
  let length = 0;
  const consuming = (async () => {
    for await (const part of parser.stream('text')) length += part.length;
  })();
  for (const chunk of stringChunks) parser.write(chunk);
  parser.end();
  await consuming;
  return length;
}, length => strictEqual(length, ascii.value.text.length));
console.log('Transports complete');

// Measure retained heap, not peak RSS. Keep the parser reachable until after measurement.
const memory = [];
if (gc) {
  const payload = 'x'.repeat(1024);
  // A separate call frame ensures the previous trial's parser cannot be live
  // at the next baseline collection (some engines retain loop-local slots).
  function measureMemory(retainRoot, collectJson) {
    gc();
    const before = process.memoryUsage().heapUsed;
    const parser = new JsonParser({retainRoot, collectJson});
    let count = 0, sum = 0;
    parser.observe(['items', Any]).subscribe(({value}) => { count++; sum += value.id; });
    parser.write('{"items":[');
    for (let i = 0; i < 50000; i++) {
      // Decode independent byte chunks, as a transport would, avoiding shared
      // string ropes that artificially reduce collectJson's retained heap.
      parser.write(Buffer.from((i ? ',' : '') + '{"id":' + i + ',"text":"' + payload + '"}'));
    }
    parser.write(']}');
    parser.end();
    gc();
    const retained = (process.memoryUsage().heapUsed - before) / MiB;
    strictEqual(count, 50000);
    strictEqual(sum, 50000 * 49999 / 2);
    if (retainRoot) strictEqual(parser.root.items.length, count);
    if (collectJson) strictEqual(parser.json.length > 50000 * 1024, true);
    return retained;
  }
  for (const retainRoot of [true, false]) {
    for (const collectJson of [false, true]) {
      const measurements = Array.from({length: 3}, () => measureMemory(retainRoot, collectJson));
      memory.push({retainRoot, collectJson, items: 50000,
        samplesMiB: measurements.map(round), retainedHeapMiB: round(median(measurements))});
    }
  }
}

const report = {
  runtime, engine, date: new Date().toISOString(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
  warmups, samples, memorySamples: 3,
  methodology: 'Prebuilt deterministic fixtures/chunks. Parser creation, subscriptions, UTF-8 decoding and writes timed. Correctness checked outside timing. GC before each sample when available. Tiny response batches 1000 parses per sample. String chunk sizes are UTF-16 code units; Buffer sizes are bytes. Throughput uses UTF-8 document size. JSON.parse receives the complete decoded string and is not streaming. Memory is retained heap delta after forced GC, not peak memory, and is engine-specific. Async consumers queue input without external I/O delays.',
  results, memory,
};
const directory = new URL('../benchmarks/results/', import.meta.url);
mkdirSync(directory, {recursive: true});
writeFileSync(new URL(`${engine}.json`, directory), JSON.stringify(report, null, 2) + '\n');
console.table(results.map(({group, dataset, mode, chunkSize, medianMs, mibPerSecond}) => ({group, dataset, mode, chunkSize, medianMs, mibPerSecond})));
console.table(memory);
console.log(`Saved benchmarks/results/${engine}.json (${results.length} timing scenarios)`);

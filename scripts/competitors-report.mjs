import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),option=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const inputDirectory=option('--input-dir','notes/benchmarks/results');
const reportPath=option('--output','notes/benchmarks/package-comparison.md');
const engines=option('--engines','node,bun').split(',');
const packages=['sapient','streamparser','stream-json','json-web-streams'];
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const key=r=>[r.dataset,r.mode,r.input,r.size].join('/');
const first=JSON.parse(readFileSync(`${inputDirectory}/v3-competitors-${engines[0]}.json`));
const measuredDate=new Date(first.date).toLocaleDateString('en-CA',{timeZone:'Europe/Kyiv'});
const revision=first.sourceRevision??'not recorded';
let doc=`# Streaming package comparison, 3.0 alpha

Measured on ${measuredDate}; recorded parser source revision \`${revision}\`, on ${first.cpu}.
Pinned versions: our ${first.versions.sapient}, @streamparser/json ${first.versions.streamparser}, stream-json ${first.versions['stream-json']},
json-web-streams ${first.versions['json-web-streams']}. JSON only in these throughput tables; JSON5 and record-manager
capabilities are listed in [the capability matrix](https://github.com/sapientpro/json-stream/blob/main/benchmarks/capabilities.md).
This is a snapshot of the recorded revision, not a measurement of the latest
main. The capability matrix tracks our newer API independently.

## Protocol and interpretation

All throughput runs use natural GC, serial fresh workers, and ${first.protocol.repetitions} rotating
package orders. Each worker checks full root contents or selected items/fragments
before timing, warms up ${first.protocol.warmups} parses, then takes seven samples of ${first.protocol.iterations} parses. Tiny
documents use 512 warmups and 128 parses/sample. Cells are medians of the ${first.protocol.repetitions}
worker medians in **decimal MB/s**, including parser construction, subscriptions,
byte decoding and input feeding. Raw files preserve individual wall and process
CPU samples; the tables use wall time. No GC call occurs in this harness or the parser.

Text chunk sizes count UTF-16 units; byte chunk sizes count UTF-8 bytes. Both use
the UTF-8 document byte size for MB/s. Fixtures and prepared chunks are identical
between packages within each row. Results describe these public API adapters, not
a universal package ranking. Small differences and cold-worker variation need
confirmation before changing runtime code. See raw sample ranges before treating
a close result as a win.

- **Root:** materialize one complete value.
- **Items:** materialize and consume each \`$.items[*]\` object, without retaining the root.
- **String:** consume decoded text before string completion. Our callbacks and
  stream-json tokens deliver independent fragments. **@streamparser/json delivers
  cumulative previews**, so its string column is a different delivery contract.
- stream-json uses its public synchronous core, assembler, pick and streamArray
  components. Its string adapter consumes stringChunk tokens; these fixtures have
  only one string value, so no extra path-filter pipeline is needed.
- json-web-streams includes Web scheduling and TextDecoderStream for byte input.
  It has no corresponding independent-fragment API; unsupported is not zero speed.
- json-stream-lite is excluded from ongoing comparisons as requested. JSON.parse
  is not ranked as a streaming alternative.

## Results

`;
const todos=[];
for(const engine of engines){
 const file=`${inputDirectory}/v3-competitors-${engine}.json`,data=JSON.parse(readFileSync(file));
 const groups=Map.groupBy(data.results,key);
 for(const [k,rows]of groups)for(const id of packages)if(rows.filter(r=>r.id===id).length!==data.protocol.repetitions)throw Error(`Incomplete ${engine} ${k} ${id}`);
 const ok=data.results.filter(r=>r.status==='ok').length,failed=data.results.filter(r=>r.status==='failed').length,unsupported=data.results.filter(r=>r.status==='unsupported').length;
 doc+=`### ${engine}${engine==='deno'?' (secondary subset)':''}\n\n\`${data.runtime.split('\n')[0]}\`; ${groups.size} scenarios, ${data.results.length} workers: ${ok} valid, ${unsupported} unsupported, ${failed} failed.\n\n| Workload | Input / chunk | Ours | @streamparser/json | stream-json | json-web-streams |\n|---|---|---:|---:|---:|---:|\n`;
 for(const [k,rows]of groups){
  const r=rows[0],scores={};
  const cells=packages.map(id=>{const found=rows.filter(r=>r.id===id);if(found.some(r=>r.status==='failed'))return 'failed';if(found.some(r=>r.status!=='ok'))return 'unsupported';const score=median(found.map(r=>r.mbps));scores[id]=score;return score.toFixed(1);});
  doc+=`| ${r.dataset} / ${r.mode} | ${r.input} / ${r.size.toLocaleString('en-US')} | ${cells.join(' | ')} |\n`;
  const fastest=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0];
  if(fastest && scores.sapient){const difference=(fastest[1]/scores.sapient-1)*100;
   let task;
   if(fastest[0]==='sapient')task='Keep this case as a regression control; no new optimization justified by this comparison.';
   else if(difference<5)task='Repeat with longer warmups and rotating process pairs before proposing any change; the gap is small.';
   else if(engine==='bun'&&r.dataset==='short strings')task='Compare stream-json\'s inline complete-string value fast path against our scanner/close/emit calls. Measure whole-string completion and JIT layout separately; keep Node, escapes and chunk cuts as controls.';
   else if(engine==='bun'&&r.dataset==='unicode'&&r.input==='bytes')task='Decode the exact byte chunks outside timing and feed the resulting identical text chunks to both parsers; separately time TextDecoder versus TextDecoderStream. Separate input transport from string construction before changing the scanner.';
   else if(r.dataset==='tiny')task='Separate parser construction/subscription cost from steady-state reset reuse; retain the fresh-parser result as the public control.';
   else if(fastest[0]==='json-web-streams')task='Measure JS builder/property writes and array allocation separately from scanning. Keep native JSON.parse aggregation as a recorded optional idea only; do not route LLM fragments through whole-value buffering.';
   else if(r.mode==='string')task='Separate escape decoding, fragment delivery and UTF-8 decoder costs. Compare only equivalent independent-fragment delivery; previews must remain a separate column.';
   else task='Profile builder/token work for this data shape, preserving strict validation and the selective-value callback contract.';
   todos.push(`- [ ] **${engine}: ${k}** — fastest ${fastest[0]}, ${fastest[1].toFixed(1)} vs ours ${scores.sapient?.toFixed(1)} MB/s (${difference.toFixed(1)}% gap). ${task}`);
  }
 }
 doc+='\n';
 const failures=data.results.filter(r=>r.status==='failed');if(failures.length)doc+='Failures and stack traces are preserved in the raw result file. Failed cases are not ranked.\n\n';
}
const checkSummary=['| Runtime | Passed | Unsupported | Failed |','|---|---:|---:|---:|',...engines.map(engine=>{const d=JSON.parse(readFileSync(`${inputDirectory}/v3-competitors-${engine}-checks.json`));return `| ${engine} | ${d.results.filter(r=>r.status==='ok').length} | ${d.results.filter(r=>r.status==='unsupported').length} | ${d.results.filter(r=>r.status==='failed').length} |`;})].join('\n');
doc+=`## Why workloads differ

The source explains architectural differences; it does not establish how many
percent each mechanism contributes without a profile or isolated experiment.

- **json-web-streams complete values:** its installed \`dist/JSONParseStreamRaw.js\`
  scans a selected object's/array's boundary, joins captured pieces and calls
  \`JSON.parse\` in \`endCapture\`. Native construction can explain an advantage on
  numeric arrays and mixed objects. It buffers the selected value until completion
  and does not offer our decoded-fragment contract. This is an inference from
  implementation and workload results, not an isolated measurement of JSON.parse.
- **stream-json:** public core methods produce token records and a separate
  assembler builds values. Its complete-string fast path scans and decodes inline
  in the value branch; the general parser handles chunk continuations. The assembler
  converts number tokens with parseFloat. Bun short-string roots are a concrete
  follow-up: compare whole-string completion costs and JIT behavior rather than
  attributing the result to token allocation alone.
- **@streamparser/json:** the tokenizer operates on bytes and encodes text input.
  It uses per-token callbacks and Number on completed numeric text, with optional
  string/number buffer settings. This comparison uses defaults. Its Unicode
  decoding and cumulative partial previews are different costs from our text
  scanner and independent string fragments. Buffer tuning is a separate experiment.
- **Our parser:** JSON and JSON5 frontends are separate; selectors drive retention,
  keys have a bounded reuse cache, and strings use native scanning plus decoded
  fragment callbacks. Complete roots still pay JS container/property construction,
  strict validation and subscription setup. These tables do not measure JSON5 or
  asynchronous downstream consumer work.

Backpressure policies cannot be compared as a single speed number: push cores
finish each write synchronously, while Web pipelines schedule queued work. Stream
scheduling is included where the public API requires it. See the capability matrix
for which layer paces input and which APIs await downstream work.

## Correctness probes

The separate check run feeds one UTF-16 unit or UTF-8 byte at a time for escaped
surrogate pairs, escaped slash and a raw Unicode boundary. Full root values and
joined fragments/previews are compared to the fixture. These probes complement,
but do not replace, each package's conformance tests. Boundary-check results are included in the archived raw files.

${checkSummary}

A passing probe is not a complete JSON conformance claim. These one-unit inputs are correctness tests, not performance
priorities for LLM streams.

## Reproduction and raw data

\`npm run benchmark:competitors\` builds, checks and compares Node and Bun, then
regenerates this report. \`npm run benchmark:competitors:deno\` adds the secondary
Deno subset after the primary run (Deno must already be installed). Runtime versions and CPU information
are stored in every result file. Fresh workers run serially; do not run several
benchmark commands concurrently or rebuild while a benchmark is active.

Raw worker samples are written to ignored \`notes/benchmarks/results\` by default.
This detailed report also stays under ignored \`notes/benchmarks\`; only the compact
current-throughput snapshot belongs in \`docs/performance.md\`. Use \`--input-dir\`
and \`--output\` to select another sample directory or report destination.
Per-case follow-up tasks can be written with \`--todo\`.

Implementation references:

- [json-web-streams source](https://github.com/zengm-games/json-web-streams): JSONParseStreamRaw capture and native value construction.
- [stream-json source](https://github.com/uhop/stream-json): core parser, assembler, pick and streamArray.
- [@streamparser/json source](https://github.com/juanjoDiaz/streamparser-json/tree/main/packages/json): tokenizer, partial options and buffers.
`;
mkdirSync(path.dirname(reportPath),{recursive:true});
writeFileSync(reportPath,doc);
const todo=option('--todo');if(todo){mkdirSync(path.dirname(todo),{recursive:true});writeFileSync(todo,`# Package comparison follow-ups, ${measuredDate}\n\nThese are hypotheses and measurement tasks, not diagnosed causes. Native aggregate parsing remains optional future work.\n\n`+todos.join('\n\n')+'\n');}
console.log(`Wrote report for ${engines.join(', ')} and ${todos.length} per-case follow-ups${todo?' to '+todo:''}.`);

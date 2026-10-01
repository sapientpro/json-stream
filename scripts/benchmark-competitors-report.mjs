import {readFileSync, writeFileSync} from 'node:fs';

const directory = new URL('../benchmarks/results/', import.meta.url);
const node = JSON.parse(readFileSync(new URL('competitors-node.json', directory), 'utf8'));
const bun = JSON.parse(readFileSync(new URL('competitors-bun.json', directory), 'utf8'));
const ids = ['sapient', 'streamparser', 'stream-json', 'json-web-streams', 'json-stream-lite'];
const names = ['Sapient', '@streamparser/json', 'stream-json', 'json-web-streams', 'json-stream-lite'];
const format = row => !row ? '—' : row.status !== 'ok' ? row.status :
  (row.retainedHeapMiB !== undefined ? row.retainedHeapMiB.toFixed(2) : row.medianMs.toFixed(3));
let output = '# Streaming JSON package comparison\n\n';
output += `${node.runtime}; ${bun.runtime}; ${node.cpu}. Generated ${new Date().toISOString()}.\n\n`;
output += 'Pinned versions: ' + ids.map((id, i) => `${names[i]} ${node.versions[id]}`).join(', ') + '.\n\n';
output += 'Every package/scenario runs sequentially in its own fresh process. Three warmups, five timed samples, median reported. Fixture creation, chunk slicing, imports, forced GC and correctness assertions are outside timing. Parser creation, subscriptions, decoding, feeding and async delivery are timed. Tiny responses use 100 iterations per sample. UTF-8 document size drives throughput. String chunk size counts UTF-16 code units; binary size counts bytes. A 45-second timeout applies to the whole worker, including warmups and checks. Failures and unsupported APIs are recorded, never ranked as successful results.\n\n';
output += 'Sapient and @streamparser use synchronous push APIs. stream-json uses its public synchronous `jsonParser` core + Assembler/pick/streamArray; a TextDecoder is included for byte input. json-web-streams uses its public Web Streams pipeline with TextDecoderStream for bytes. json-stream-lite uses its public async pull entities over the same prepared chunks. Stream/async scheduling is included where the library requires it. JSON.parse is a baseline over the full decoded string. This compares usable APIs, not identical scheduling or equivalent syntax strictness.\n\n';
output += 'For selected items, adapters count items and sum IDs without storing results. Root results are deep-compared with JSON.parse. String scenarios check concatenated decoded content before timing and count UTF-16 units during timing. @streamparser emits cumulative partial-value previews: its string scenario measures previews plus the final string, rather than independent fragment emission; it still retains the whole string.\n\n';
output += 'json-stream-lite string consumption stops after the selected string entity is exhausted; continuing its parent iterator attempts to consume the entity a second time. Other string adapters finish the document. Fixtures contain only that string field, so the remaining document is a closing brace.\n\n';
output += 'Retained-heap measurements keep each returned holder alive during GC. For stream-json, that holder includes the tokenizer, assembler, selection filter, array streamer and decoder, including selective modes with no assembler.\n\n';
const descriptions = {
  ascii: 'One 1 MiB ASCII string', unicode: '24,000 repetitions of Cyrillic, CJK and emoji',
  escapes: '15,000 escaped sequences, including a surrogate pair', numbers: '50,000 integers',
  decimals: '30,000 decimals with exponents', literals: '90,000 booleans/nulls',
  'short strings': '40,000 short strings', wide: '15,000 object keys', empty: '30,000 empty arrays/objects',
  nested: '200 branches, each 128 arrays deep', tiny: 'Small response; 100 iterations per sample',
  objects: '8,000 mixed objects with nested metadata and Cyrillic text'
};
output += '## Fixtures\n\n| Dataset | Content | UTF-8 KiB |\n|---|---|---:|\n';
for (const [dataset, description] of Object.entries(descriptions)) {
  const row = node.results.find(row => row.id === 'sapient' && row.mode === 'root' && row.dataset === dataset);
  output += `| ${dataset} | ${description} | ${(row.bytes / 1024).toFixed(1)} |\n`;
}
output += '\n';
for (const [label, report] of [['Node', node], ['Bun', bun]]) {
  output += `## ${label}: full-root parsing, 1 KiB input\n\nMilliseconds; lower is better.\n\n`;
  output += '| Dataset / input | ' + names.join(' | ') + ' | JSON.parse |\n|---|' + names.map(() => '---:').join('|') + '|---:|\n';
  const datasets = [...new Set(report.results.filter(row => row.mode === 'root' && row.dataset !== 'memory').map(row => row.dataset))];
  for (const dataset of datasets) for (const input of ['string', 'bytes']) {
    const find = id => report.results.find(row => row.id === id && row.mode === 'root' && row.dataset === dataset && row.input === input && row.size === 1024);
    const native = report.results.find(row => row.id === 'native' && row.dataset === dataset);
    output += `| ${dataset} / ${input} | ${ids.map(id => format(find(id))).join(' | ')} | ${format(native)} |\n`;
  }
  for (const mode of ['root', 'items', 'string']) {
    output += `\n## ${label}: ${mode === 'root' ? 'byte chunk sizes' : mode === 'items' ? 'selected array items' : 'string content / partial previews'}\n\n`;
    output += '| Dataset / bytes per chunk | ' + names.join(' | ') + ' |\n|---|' + names.map(() => '---:').join('|') + '|\n';
    const rows = report.results.filter(row => row.id === 'sapient' && row.mode === mode && row.dataset !== 'memory' && (mode !== 'root' || row.input === 'bytes' && row.size !== 1024));
    for (const row of rows) output += `| ${row.dataset} / ${row.size === 1e9 ? 'whole' : row.size} | ` +
      ids.map(id => format(report.results.find(other => other.id === id && other.mode === row.mode && other.dataset === row.dataset && other.input === row.input && other.size === row.size))).join(' | ') + ' |\n';
  }
  output += `\n## ${label}: retained heap\n\n20,000 objects with 1 KiB payloads. Median of three heap deltas after forced GC, with all returned structures kept alive. Prepared input already exists before the baseline; input buffering/decoded text retained by the parser is included. This is not peak memory or RSS; tiny/negative values can be GC noise and engines account differently.\n\n`;
  output += '| Mode | ' + names.join(' | ') + ' |\n|---|' + names.map(() => '---:').join('|') + '|\n';
  for (const mode of ['root', 'items']) output += `| ${mode} (MiB) | ` + ids.map(id => format(report.results.find(row => row.id === id && row.dataset === 'memory' && row.mode === mode))).join(' | ') + ' |\n';
  const failures = report.results.filter(row => row.status === 'failed');
  output += `\n## ${label}: failures (${failures.length})\n\n`;
  for (const row of failures) output += `- ${row.id}: ${row.dataset}, ${row.mode}, ${row.input}, chunk ${row.size}: ${row.reason.split('\n')[0]}\n`;
  const checkFile = new URL(`competitors-checks-${label.toLowerCase()}.json`, directory);
  let checks;
  try { checks = JSON.parse(readFileSync(checkFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (checks) {
    output += `\n## ${label}: escape and Unicode correctness probes\n\nOne-byte/code-unit input chunks. Status only; these small probes are not performance comparisons.\n\n`;
    output += '| Probe / mode / input | ' + names.join(' | ') + ' |\n|---|' + names.map(() => '---').join('|') + '|\n';
    for (const row of checks.results.filter(row => row.id === 'sapient')) {
      output += `| ${row.dataset} / ${row.mode} / ${row.input} | ` + ids.map(id =>
        checks.results.find(other => other.id === id && other.dataset === row.dataset && other.mode === row.mode && other.input === row.input)?.status ?? '—').join(' | ') + ' |\n';
    }
  }
}
output += '\nCapability matrix: [capabilities.md](../capabilities.md). Raw results include every timing sample, throughput and failure details: [Node](competitors-node.json), [Bun](competitors-bun.json).\n';
writeFileSync(new URL('competitors.md', directory), output);
console.log('Saved benchmarks/results/competitors.md');

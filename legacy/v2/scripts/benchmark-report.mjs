import {readFileSync, writeFileSync} from 'node:fs';

const directory = new URL('../../../benchmarks/results/', import.meta.url);
const node = JSON.parse(readFileSync(new URL('node.json', directory), 'utf8'));
const bun = JSON.parse(readFileSync(new URL('bun.json', directory), 'utf8'));
const key = row => JSON.stringify([row.group, row.dataset, row.mode, row.chunkSize]);
const bunRows = new Map(bun.results.map(row => [key(row), row]));
if (node.results.length !== bun.results.length || node.results.some(row => !bunRows.has(key(row)))) {
  throw new Error('Runtime reports have different scenarios. Run npm run benchmark:legacy to regenerate both.');
}
const number = value => value.toFixed(3);
let md = `# JSON-stream benchmark\n\n`;
md += `- Node: ${node.runtime} (${node.date})\n- Bun: ${bun.runtime} (${bun.date})\n`;
md += `- Machine: ${node.cpu}; ${node.platform} ${node.arch}\n`;
md += `- ${node.warmups} warmups and ${node.samples} timed samples per scenario; all samples, median, min and max saved in JSON.\n`;
md += `- ${node.results.length} timing scenarios per runtime; ${node.memorySamples} samples per memory scenario.\n\n`;
md += `${node.methodology}\n\n`;
md += 'Run `npm run benchmark:legacy` to regenerate both runtime reports and this comparison.\n\n';
for (const group of new Set(node.results.map(row => row.group))) {
  md += `## ${group}\n\n`;
  md += '| Dataset | MiB (UTF-8) | Mode | Chunk size | Node ms | Bun ms | Node MiB/s | Bun MiB/s | Node/Bun time |\n';
  md += '|---|---:|---|---:|---:|---:|---:|---:|---:|\n';
  for (const row of node.results.filter(row => row.group === group)) {
    const other = bunRows.get(key(row));
    md += `| ${row.dataset} | ${number(row.bytes / 1024 / 1024)} | ${row.mode} | ${row.chunkSize} | ${row.medianMs.toFixed(4)} | ${other.medianMs.toFixed(4)} | ${number(row.mibPerSecond)} | ${number(other.mibPerSecond)} | ${(row.medianMs / other.medianMs).toFixed(2)}× |\n`;
  }
  md += '\n';
}
md += '## Retained memory\n\n50,000 selected objects, each with a 1 KiB string. Input is generated incrementally as independent UTF-8 Buffers (one item per chunk). Observers count/sum values without retaining them. Median heap delta after forced GC; small or negative deltas reflect GC/accounting noise. These are not peak-memory measurements.\n\n';
md += '| retainRoot | collectJson | Node heap MiB | Bun heap MiB |\n|---|---|---:|---:|\n';
for (const row of node.memory) {
  const other = bun.memory.find(value => value.retainRoot === row.retainRoot && value.collectJson === row.collectJson);
  md += `| ${row.retainRoot} | ${row.collectJson} | ${number(row.retainedHeapMiB)} | ${other ? number(other.retainedHeapMiB) : 'n/a'} |\n`;
}
md += '\nRaw measurements: [Node](node.json), [Bun](bun.json).\n';
writeFileSync(new URL('comparison.md', directory), md);
console.log('Saved benchmarks/results/comparison.md');

import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir, cpus} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {deepStrictEqual, strictEqual} from 'node:assert';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const isBun = typeof Bun !== 'undefined';
const runtime = isBun ? `Bun ${Bun.version}` : `Node ${process.version}`;
const gc = isBun ? () => Bun.gc(true) : globalThis.gc;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const scenarios = ['numbers', 'short strings', 'wide object', 'array of objects', 'one large string', 'streamed 2 MiB', 'streamed 4 MiB', 'streamed 8 MiB'];

if (process.argv[2] === '--worker') {
  const {JsonParser} = require(process.argv[3]);
  const name = process.argv[4];
  const size = Number(process.argv[5]);
  let value;
  if (name === 'numbers') value = Array.from({length: 200000}, (_, i) => i);
  else if (name === 'short strings') value = Array.from({length: 200000}, (_, i) => `value-${i}`);
  else if (name === 'wide object') value = Object.fromEntries(Array.from({length: 50000}, (_, i) => [`key-${i}`, `value-${i}`]));
  else if (name === 'array of objects') value = Array.from({length: 50000}, (_, i) => ({id: i, name: `value-${i}`, active: i % 2 === 0}));
  else if (name === 'one large string') {
    const bytes = JSON.stringify(Array.from({length: 200000}, (_, i) => `value-${i}`)).length;
    value = 'x'.repeat(bytes - 2);
  } else value = 'x'.repeat(Number(name.split(' ')[1]) * 1024 * 1024);
  const text = JSON.stringify(value);
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  const parse = () => {
    const parser = new JsonParser();
    let length = 0;
    if (name.startsWith('streamed')) parser.chunks([]).subscribe(part => { length += part.length; });
    for (const chunk of chunks) parser.write(chunk);
    parser.end();
    return {parser, length};
  };
  const verify = ({parser, length}) => {
    deepStrictEqual(parser.root, value);
    if (name.startsWith('streamed')) strictEqual(length, value.length);
  };
  for (let i = 0; i < 10; i++) verify(parse());
  const samples = [];
  for (let i = 0; i < 9; i++) {
    gc?.();
    const start = performance.now();
    const result = parse();
    samples.push(performance.now() - start);
    verify(result);
  }
  const medianMs = median(samples);
  console.log(JSON.stringify({name, chunkSize: size, bytes: Buffer.byteLength(text), medianMs,
    mibPerSecond: Buffer.byteLength(text) / 1048576 / (medianMs / 1000), samplesMs: samples}));
} else {
  const ts = require('typescript');
  const temporary = mkdtempSync(join(tmpdir(), 'json-stream-regression-'));
  try {
    // Compile immutable source snapshots identically, without touching either checkout or dist.
    for (const variant of ['head', 'working']) {
      const directory = join(temporary, variant);
      mkdirSync(directory);
      writeFileSync(join(directory, 'package.json'), '{"type":"commonjs"}');
      for (const file of ['parser', 'subject']) {
        const source = variant === 'head'
          ? execFileSync('git', ['show', `HEAD:legacy/v2/src/${file}.ts`], {cwd: root, encoding: 'utf8'})
          : readFileSync(join(root, 'legacy/v2/src', `${file}.ts`), 'utf8');
        const {outputText} = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS}});
        writeFileSync(join(directory, `${file}.js`), outputText);
      }
    }
    const results = [];
    const requestedCase = process.argv[2] === '--case' ? process.argv[3] : undefined;
    if (requestedCase && !scenarios.includes(requestedCase)) throw new Error(`Unknown workload: ${requestedCase}`);
    for (const name of requestedCase ? [requestedCase] : scenarios) {
      const chunkSize = name.startsWith('streamed') ? 1024 : 65536;
      const row = {name, chunkSize};
      for (const variant of ['head', 'working']) {
        const args = [...(isBun ? [] : ['--expose-gc']), script, '--worker', join(temporary, variant, 'parser.js'), name, String(chunkSize)];
        row[variant] = JSON.parse(execFileSync(process.execPath, args, {cwd: root, encoding: 'utf8'}));
      }
      row.throughputChangePercent = (row.working.mibPerSecond / row.head.mibPerSecond - 1) * 100;
      results.push(row);
      console.log(`${name}: HEAD ${row.head.mibPerSecond.toFixed(1)} → working ${row.working.mibPerSecond.toFixed(1)} MiB/s (${row.throughputChangePercent.toFixed(1)}%)`);
    }
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
    const report = {runtime, cpu: cpus()[0]?.model, date: new Date().toISOString(), head,
      methodology: 'Each variant/scenario runs in a fresh process, using identically transpiled source snapshots with native private fields (ESNext, matching the ESM build). 10 warmups and median of 9 samples. Prebuilt string chunks; parser creation included; deep equality/count checks outside timing; forced GC before samples. MiB/s uses UTF-8 bytes. No subscribers except streamed scenarios.', results};
    const directory = resolve(root, 'benchmarks/results');
    mkdirSync(directory, {recursive: true});
    const prefix = `regression-${isBun ? 'bun' : 'node'}${requestedCase ? '-check' : ''}`;
    writeFileSync(join(directory, `${prefix}.json`), JSON.stringify(report, null, 2) + '\n');
    let md = `# HEAD vs working tree — ${runtime}\n\nHEAD: ${head}\n\n${report.methodology}\n\n`;
    md += '| Workload | Chunk size | HEAD MiB/s | Working MiB/s | Throughput change |\n|---|---:|---:|---:|---:|\n';
    for (const row of results) md += `| ${row.name} | ${row.chunkSize} | ${row.head.mibPerSecond.toFixed(1)} | ${row.working.mibPerSecond.toFixed(1)} | ${row.throughputChangePercent.toFixed(1)}% |\n`;
    writeFileSync(join(directory, `${prefix}.md`), md);
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
}

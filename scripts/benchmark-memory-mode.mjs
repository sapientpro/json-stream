// Serial, natural-GC parser-only controls. Baseline must be a built v3 index.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const baseline = option('--baseline');
if (!baseline) throw new Error('Pass --baseline /path/to/built/index.js');
const output = option('--output', 'notes/analysis/memory-mode-final.json');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'json-memory-mode-'));
const versions = [{label:'baseline', module:baseline}, {label:'fast', module:'dist/esm/index.js'}, {label:'compact', module:'dist/esm/index.js', memoryMode:'compact'}];
const cases = [['json','llm','string',32], ['json5','llm','string',32], ['json','short strings','scalar',65536], ['json','scalar','root',128]];
const results = [], runtimes = {};
fs.mkdirSync(path.dirname(output), {recursive:true});
const hashes = {};
for (const version of versions) for (const file of fs.readdirSync(path.dirname(version.module)).filter(f=>f.endsWith('.js')))
    hashes[version.label+'/'+file] = createHash('sha256').update(fs.readFileSync(path.join(path.dirname(version.module),file))).digest('hex');
try {
    for (const engine of ['node','bun']) {
        runtimes[engine] = execFileSync(engine,['--version'],{encoding:'utf8'}).trim();
        for (let repetition=0; repetition<3; repetition++) for (const [format,dataset,mode,size] of cases)
            for (const version of repetition%2 ? [...versions].reverse() : versions) {
                fs.rmSync(stage,{recursive:true,force:true});
                fs.cpSync(path.dirname(version.module),stage,{recursive:true});
                fs.writeFileSync(path.join(stage,'package.json'),' {"type":"module"}');
                const tiny = dataset==='scalar';
                const job = {...version, module:pathToFileURL(path.join(stage,'index.js')).href, format,syntax:format,dataset,mode,size,repetition,input:'text',gc:'natural',cpu:true,warmups:tiny?8192:128,iterations:tiny?32768:32};
                const row = JSON.parse(execFileSync(engine,['scripts/benchmark-worker.mjs',JSON.stringify(job)],{encoding:'utf8',timeout:180000}));
                results.push({engine,...row});
                fs.writeFileSync(output,JSON.stringify({runtimes,hashes,protocol:{serial:true,samePath:true,samples:7,repetitions:3,input:'text',gc:'natural',setupIncluded:true},results},null,2)+'\n');
                console.log(`${results.length}/72 ${engine} ${version.label} ${format} ${dataset}: ${row.mbps.toFixed(1)} MB/s`);
            }
    }
} finally { fs.rmSync(stage,{recursive:true,force:true}); }

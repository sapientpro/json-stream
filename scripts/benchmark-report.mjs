import fs from 'node:fs';
const args=process.argv.slice(2);
const at=args.indexOf('--output');
const output=at<0?'notes/analysis/v3-release-comparison.md':args.splice(at,2)[1];
const inputs=args;
if(!inputs.length)throw new Error('Pass benchmark JSON result paths');
const reports=inputs.map(file=>({file,...JSON.parse(fs.readFileSync(file,'utf8'))}));
const lines=['# 3.0 candidate throughput comparison','', 'All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.',''];
for(const report of reports){
 const baselineLabel=report.results[0].label;
 lines.push(`## ${report.engine}`, '', '`'+report.runtime+'`','',JSON.stringify(report.protocol),'',`| workload | chunk | ${baselineLabel} MB/s | candidate MB/s | Δ | pair range |`,'|---|---:|---:|---:|---:|---:|');
 const keys=[...new Set(report.results.map(r=>JSON.stringify([r.dataset,r.mode,r.size,r.input])))];
 const median=nums=>{nums.sort((a,b)=>a-b);const at=Math.floor(nums.length/2);return nums.length%2?nums[at]:(nums[at-1]+nums[at])/2;};
 for(const key of keys){const [dataset,mode,size,input]=JSON.parse(key),rows=report.results.filter(r=>JSON.stringify([r.dataset,r.mode,r.size,r.input])===key),labels=[...new Set(rows.map(r=>r.label))];if(labels.length!==2)continue;
 const base=rows.filter(r=>r.label==='2.0.1'||r.label===labels[0]),next=rows.filter(r=>r.label!==base[0].label),b=median(base.map(r=>r.mbps)),n=median(next.map(r=>r.mbps)),deltas=base.map(r=>100*(next.find(x=>x.repetition===r.repetition).mbps/r.mbps-1));
 const chunk=rows[0].chunkPattern?`varying ${Math.min(...rows[0].chunkPattern)}–${Math.max(...rows[0].chunkPattern)} code points`:rows[0].chunkUnit==='codepoint'?`${size} code points`:String(size);
 lines.push(`| ${dataset}/${mode} (${input}) | ${chunk} | ${b.toFixed(1)} | ${n.toFixed(1)} | ${(100*(n/b-1)).toFixed(1)}% | ${Math.min(...deltas).toFixed(1)}…${Math.max(...deltas).toFixed(1)}% |`);
 }
 lines.push('');
}
fs.writeFileSync(output,lines.join('\n'));console.log(output);

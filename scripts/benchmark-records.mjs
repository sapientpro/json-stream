import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
    JsonParser,
    JsonLinesParser,
    PrefixedJsonParser,
    createDecodedInput,
} from '../dist/esm/index.js';
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
if (process.argv[2] === '--worker') {
    const { kind, dataset, size } = JSON.parse(process.argv[3]);
    const count = dataset === 'long strings' ? 24 : dataset === 'objects' ? 4000 : 10000;
    const values = Array.from({ length: count }, (_, id) =>
        dataset === 'numbers'
            ? id
            : dataset === 'long strings'
              ? { id, s: 'a'.repeat(32768) }
              : dataset === 'unicode'
                ? { id, s: '€😀漢字' }
                : dataset === 'escapes'
                  ? { id, s: '\n\t\\"😀' }
                  : { id, name: 'item', nested: { active: true } },
    );
    const enc = new TextEncoder(),
        records = values.map((v) => enc.encode(JSON.stringify(v)));
    const payload = records.reduce((n, b) => n + b.length, 0),
        input = enc.encode(
            values
                .map((v) => (kind === 'prefix' ? 'garbage data:' : '') + JSON.stringify(v))
                .join('\n') + '\n',
        );
    const fragmented = dataset === 'long strings';
    function parse() {
        let seen = 0,
            last = -1,
            chars = 0;
        const bind = (p) => {
            p.onValue(dataset === 'numbers' ? [] : ['id'], (v, path) => {
                seen++;
                last = v;
                void path.length;
            });
            if (fragmented) p.onString(['s'], (v) => (chars += v.length));
        };
        if (kind === 'direct')
            for (const record of records) {
                const p = new JsonParser({});
                bind(p);
                const sink = createDecodedInput(p);
                for (let pos = 0; pos < record.length; pos += size)
                    sink.write(record.subarray(pos, pos + size));
                sink.end();
            }
        else {
            const p =
                kind === 'jsonl' ? new JsonLinesParser({}) : new PrefixedJsonParser('data:', {});
            bind(p);
            for (let pos = 0; pos < input.length; pos += size)
                p.write(input.subarray(pos, pos + size));
            p.end();
            if (p.recordCount !== count) throw Error('record count');
        }
        if (seen !== count || last !== count - 1 || (fragmented && chars !== count * 32768))
            throw Error('incorrect results');
    }
    parse();
    for (let i = 0; i < 12; i++) parse();
    const samples = [];
    for (let i = 0; i < 7; i++) {
        globalThis.gc?.();
        const start = performance.now();
        for (let j = 0; j < 3; j++) parse();
        samples.push((performance.now() - start) / 3);
    }
    const ms = median(samples);
    console.log(
        JSON.stringify({
            kind,
            dataset,
            size,
            records: count,
            mbps: payload / (ms * 1000),
            recordsPerSecond: (count * 1000) / ms,
            samplesMs: samples,
        }),
    );
} else {
    const engine = process.argv[2] ?? 'node',
        output = process.argv[3] ?? `notes/analysis/v3-records-${engine}.json`,
        results = [];
    for (let pair = 0; pair < 2; pair++)
        for (const size of [1024, 65536])
            for (const dataset of ['numbers', 'objects', 'unicode', 'escapes', 'long strings'])
                for (const kind of pair % 2
                    ? ['prefix', 'jsonl', 'direct']
                    : ['direct', 'jsonl', 'prefix']) {
                    const args = [
                        ...(engine === 'node' ? ['--expose-gc'] : []),
                        fileURLToPath(import.meta.url),
                        '--worker',
                        JSON.stringify({ kind, dataset, size }),
                    ];
                    const result = JSON.parse(
                        execFileSync(engine, args, { encoding: 'utf8', timeout: 180000 }),
                    );
                    results.push({ ...result, pair });
                    fs.writeFileSync(
                        output,
                        JSON.stringify(
                            {
                                engine,
                                protocol: {
                                    pairs: 2,
                                    warmups: 12,
                                    samples: 7,
                                    iterations: 3,
                                    serialWorkers: true,
                                    units: 'payload decimal MB/s',
                                    baseline:
                                        'pre-framed per-record parser; excludes boundary search, includes parser construction and registration',
                                },
                                results,
                            },
                            null,
                            2,
                        ),
                    );
                    console.log(
                        `${results.length}/60 ${dataset} ${kind} ${size}: ${result.mbps.toFixed(1)} MB/s`,
                    );
                }
}

import { deepStrictEqual } from 'node:assert';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

// Includes per-document construction, callback binding and EOF, with natural GC.
// node scripts/benchmark-plans.mjs --engine bun --baseline /path/to/main/dist/esm/index.js
const args = process.argv.slice(2);
const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at < 0 ? fallback : args[at + 1];
};
const fixtures = [
    {
        name: 'short-values',
        selectors: [{ path: '$.id' }, { path: '$.usage.total' }, { path: '$.done' }],
        text: JSON.stringify({
            id: 42,
            usage: { input: 12, total: 21 },
            done: true,
            message: 'Привіт світе 😀',
        }),
    },
    {
        name: 'llm-fragments32',
        selectors: [
            { path: '$.choices[*].delta.content', string: true },
            { path: '$.usage.total_tokens' },
            { path: '$.id' },
        ],
        text: JSON.stringify({
            id: 'reply-42',
            choices: [{ delta: { content: 'Привіт, це відповідь 😀. '.repeat(12) }, index: 0 }],
            usage: { total_tokens: 37 },
        }),
        size: 32,
    },
    {
        name: 'wildcard-items',
        selectors: [{ path: '$.items[*].id' }, { path: '$.metadata.total' }],
        text: JSON.stringify({
            metadata: { total: 24 },
            items: Array.from({ length: 24 }, (_, id) => ({
                id,
                title: 'item ' + id,
                active: true,
            })),
        }),
    },
    {
        name: 'recursive',
        selectors: [
            { path: '$..id' },
            { path: '$..message', string: true },
            { path: '$.items[*].id' },
        ],
        text: JSON.stringify({
            id: 1,
            items: [
                { id: 2, nested: { id: 3, message: 'hello' } },
                { id: 4, message: 'world' },
            ],
        }),
    },
    {
        name: '32-selectors',
        selectors: Array.from({ length: 32 }, (_, i) => ({ path: '$.fields.key' + i })),
        text: JSON.stringify({
            fields: Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['key' + i, i])),
            extra: 123,
        }),
    },
    {
        name: 'large-selective',
        selectors: [{ path: '$.items[*].id' }, { path: '$.metadata.total' }],
        text: JSON.stringify({
            metadata: { total: 3000 },
            items: Array.from({ length: 3000 }, (_, id) => ({
                id,
                title: 'item ' + id,
                active: true,
                value: id / 3,
            })),
        }),
    },
    {
        name: 'large-root',
        selectors: [{ path: '$' }],
        text: JSON.stringify(
            Array.from({ length: 3000 }, (_, id) => ({
                id,
                title: 'item ' + id,
                active: true,
                value: id / 3,
            })),
        ),
    },
];

fixtures.push({ name: 'short-root', selectors: [{ path: '$' }], text: fixtures[0].text });
fixtures.push({ name: 'no-consumers', selectors: [], text: fixtures[5].text });

function consume(parser, fixture) {
    if (fixture.size)
        for (let i = 0; i < fixture.text.length; i += fixture.size)
            parser.write(fixture.text.slice(i, i + fixture.size));
    else parser.write(fixture.text);
    parser.end();
}
if (args[0] === '--worker') {
    const job = JSON.parse(args[1]),
        api = await import(job.module);
    const fixture = fixtures.find((f) => f.name === job.name);
    const Parser = job.format === 'json5' ? api.Json5Parser : api.JsonParser;
    const paths = fixture.selectors.map((s) => api.compileJsonPath(s.path));
    const plan =
        job.mode === 'plan'
            ? api.compileSelectors(
                  fixture.selectors.map((s) => ({
                      path: s.path,
                      kind: s.string ? 'string' : 'value',
                  })),
              )
            : undefined;
    function make(callbacks, planned = true) {
        const parser = new Parser();
        if (plan && planned) plan.bind(parser, callbacks);
        else
            fixture.selectors.forEach((s, i) => {
                parser[s.string ? 'onString' : 'onValue'](
                    job.mode === 'strings' ? s.path : paths[i],
                    callbacks[i],
                );
            });
        return parser;
    }
    const capture = (planned) => {
        const events = [];
        consume(
            make(
                fixture.selectors.map((_, i) => ({
                    next: (v, p) => events.push([i, v, p]),
                    end: (p) => events.push(['end', i, p]),
                    complete: () => events.push(['complete', i]),
                })),
                planned,
            ),
            fixture,
        );
        return events;
    };
    deepStrictEqual(capture(true), capture(false));
    let checksum = 0;
    const callbacks = fixture.selectors.map(() => (v) => {
        checksum += typeof v === 'number' ? v : typeof v === 'string' ? v.length : 1;
    });
    const batch = fixture.text.length > 100000 ? 2 : 40;
    const run = () => consume(make(callbacks), fixture);
    let start = performance.now();
    do {
        for (let i = 0; i < batch; ++i) run();
    } while (performance.now() - start < job.warmup);
    let count = 0;
    const cpu = process.cpuUsage();
    start = performance.now();
    do {
        for (let i = 0; i < batch; ++i) run();
        count += batch;
    } while (performance.now() - start < job.duration);
    const elapsed = performance.now() - start,
        used = process.cpuUsage(cpu);
    console.log(
        JSON.stringify({
            name: job.name,
            format: job.format,
            label: job.label,
            mode: job.mode,
            us: (elapsed * 1000) / count,
            cpuUs: (used.user + used.system) / count,
            mbps: (Buffer.byteLength(fixture.text) * count) / elapsed / 1000,
            count,
            checksum,
            runtime: globalThis.Bun?.version ?? globalThis.Deno?.version.deno ?? process.version,
        }),
    );
} else {
    const engine = option('--engine', 'node'),
        format = option('--format', 'all');
    if (!['node', 'bun', 'deno'].includes(engine)) throw Error('Invalid engine');
    if (!['json', 'json5', 'all'].includes(format)) throw Error('Invalid format');
    const pairs = Number(option('--pairs', '3')),
        warmup = Number(option('--warmup', '200')),
        duration = Number(option('--duration', '600'));
    if (
        !Number.isSafeInteger(pairs) ||
        pairs < 1 ||
        !Number.isFinite(warmup) ||
        warmup <= 0 ||
        !Number.isFinite(duration) ||
        duration <= 0
    )
        throw Error('Invalid benchmark interval/pairs');
    const module = new URL('../dist/esm/index.js', import.meta.url).href;
    const baseline = option('--baseline');
    const versions = baseline
        ? [
              {
                  label: 'baseline strings',
                  mode: 'strings',
                  module: pathToFileURL(resolve(baseline)).href,
              },
              {
                  label: 'baseline arrays',
                  mode: 'arrays',
                  module: pathToFileURL(resolve(baseline)).href,
              },
              { label: 'current arrays', mode: 'arrays', module },
              { label: 'plan', mode: 'plan', module },
          ]
        : [
              { label: 'strings', mode: 'strings', module },
              { label: 'arrays', mode: 'arrays', module },
              { label: 'plan', mode: 'plan', module },
          ];
    const names = option('--cases')?.split(','),
        selected = names ? fixtures.filter((f) => names.includes(f.name)) : fixtures;
    if (!selected.length || names?.some((name) => !fixtures.some((f) => f.name === name)))
        throw Error('Unknown case');
    const rows = [],
        output = resolve(option('--output', 'notes/analysis/selector-plans-' + engine + '.json'));
    mkdirSync(dirname(output), { recursive: true });
    for (let round = 0; round < pairs; ++round)
        for (const dialect of format === 'all' ? ['json', 'json5'] : [format])
            for (const fixture of selected) {
                for (const version of round % 2 ? [...versions].reverse() : versions) {
                    const job = {
                        ...version,
                        name: fixture.name,
                        format: dialect,
                        warmup,
                        duration,
                    };
                    const command = [
                        ...(engine === 'deno' ? ['run', '--allow-read'] : []),
                        fileURLToPath(import.meta.url),
                        '--worker',
                        JSON.stringify(job),
                    ];
                    const result = spawnSync(option('--runtime', engine), command, {
                        encoding: 'utf8',
                    });
                    if (result.status !== 0)
                        throw Error(result.stderr || 'Benchmark worker failed');
                    rows.push({ round, ...JSON.parse(result.stdout) });
                }
                writeFileSync(
                    output,
                    JSON.stringify({ engine, pairs, warmup, duration, rows }, null, 2),
                );
                console.log(engine, dialect, fixture.name, 'pair', round + 1);
            }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    for (const dialect of format === 'all' ? ['json', 'json5'] : [format])
        for (const fixture of selected) {
            const values = versions.map((v) => {
                const samples = rows.filter(
                    (r) => r.label === v.label && r.format === dialect && r.name === fixture.name,
                );
                return (
                    v.label +
                    ': ' +
                    median(samples.map((s) => s.us)).toFixed(2) +
                    ' us/doc, ' +
                    median(samples.map((s) => s.mbps)).toFixed(1) +
                    ' MB/s'
                );
            });
            console.log(dialect, fixture.name, values.join(' | '));
        }
}

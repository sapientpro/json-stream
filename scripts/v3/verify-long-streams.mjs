// Lifecycle/retained-memory diagnostic only; GC never enters parser/runtime code.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { JsonParser, Json5Parser, JsonLinesParser, PrefixedJsonParser, createDecodedInput } from '../../dist/esm/v3/index.js';
if (process.argv[2] === '--worker') {
    const job = JSON.parse(process.argv[3]), errors = [], options = { format: job.format, maxBufferedChunks: 4, onObserverError: e => errors.push(String(e)) };
    const Parser = job.format === 'json' ? JsonParser : Json5Parser;
    const parser = job.manager === 'core' ? new Parser(options) : job.manager === 'jsonl' ? new JsonLinesParser(options) : new PrefixedJsonParser('BEGIN', options);
    // Core accepts text only; byte transport owns decoding and its EOF flush.
    // Record managers already own their decoder; this adapter preserves that policy.
    const inputSink = job.input === 'bytes' ? createDecodedInput(parser) : parser;
    const encoder = new TextEncoder(), held = [], fragmentText = ('π😀BEGIN\\\n"').repeat(24) + String.fromCharCode(0xd800), checkpoints = [1000, 5000, 20000], snapshots = [];
    let values = 0, ends = 0, fragments = 0, pending = '', current = 0, subscription, stream;
    parser.onValue('$.items[*]', (value, path, index) => {
        deepStrictEqual(value, {id: current, text: fragmentText});
        deepStrictEqual(path, ['items', 0]);
        if (job.manager !== 'core') strictEqual(index, current);
        ++values;
        held.push([value, path]);
        if (held.length > 8) held.shift();
    });
    if (job.consumer === 'normal') {
        parser.onString('$.items[*].text', {
            next(value, path) {
                ++fragments;
                pending += value;
                deepStrictEqual(path, ['items', 0, 'text']);
            },
            end(path, index) {
                strictEqual(pending, fragmentText);
                deepStrictEqual(path, ['items', 0, 'text']);
                pending = '';
                ++ends;
                if (job.manager !== 'core') strictEqual(index, current);
            }
        });
    } else if (job.consumer === 'cancel') {
        subscription = parser.onString('$.items[*].text', () => {
            ++fragments;
            subscription.unsubscribe();
        });
    } else {
        stream = parser.stringStream('$.items[*].text');
    }
    const gc = typeof Bun === 'undefined' ? globalThis.gc : () => Bun.gc(true);
    if (typeof gc !== 'function')
        throw Error('Memory worker needs --expose-gc on Node or Bun');
    const snapshot = async (count, phase = 'active') => {
        for (let n = 0; n < 3; n++) {
            await new Promise(resolve => setTimeout(resolve, 0));
            gc();
        }
        snapshots.push({records: count, phase, ...process.memoryUsage()});
    };
    await snapshot(0);
    for (current = 0; current < 20000; current++) {
        let doc = JSON.stringify({ skip: [{ ['unused' + current]: [null, false, {}, []] }], items: [{ id: current, text: fragmentText }] });
        if (job.format === 'json5')
            doc = '/*record*/' + doc.replace(/"(skip|items|id|text)":/g, '$1:');
        if (job.manager === 'jsonl')
            doc += '\n';
        if (job.manager === 'prefix')
            doc = 'noise\r\nBEGIN' + doc;
        const input = job.input === 'text' ? doc : encoder.encode(doc), sizes = [8, 32, 128];
        for (let at = 0, n = current % 3; at < input.length; n++) {
            const size = sizes[n % 3];
            inputSink.write(input.slice(at, at + size));
            at += size;
        }
        if (job.manager === 'core' && current < 19999)
            parser.reset();
        strictEqual(values, current + 1);
        if (job.consumer === 'normal')
            strictEqual(ends, current + 1);
        if (checkpoints.includes(current + 1))
            await snapshot(current + 1);
    }
    inputSink.end();
    strictEqual(parser.closed, true);
    if (job.manager !== 'core') strictEqual(parser.recordCount, 20000);
    if (stream) {
        let rejected = false;
        try {
            await stream.getReader().read();
        }
        catch (e) {
            strictEqual(e instanceof RangeError, true);
            rejected = true;
        }
        strictEqual(rejected, true);
    }
    if (job.consumer === 'cancel')
        strictEqual(fragments, 1);
    strictEqual(errors.length, 0);
    for (let n = 0; n < held.length; n++)
        deepStrictEqual(held[n], [{ id: 20000 - held.length + n, text: fragmentText }, ['items', 0]]);
    await snapshot(20000, 'closed');
    const growth = Object.fromEntries(['heapUsed', 'external', 'arrayBuffers', 'rss'].map(k => [k, (snapshots[3][k] - snapshots[1][k]) / 1048576]));
    console.log(JSON.stringify({ ...job, passed: true, records: values, fragments, ends, growth1000To20000MiB: growth, snapshots }));
}
else {
    const args = process.argv.slice(2), option = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
    const engines = option('--engines', 'node,bun').split(','), output = option('--output', 'notes/analysis/v3-long-streams/results.json');
    if (engines.some(e => !['node', 'bun'].includes(e)))
        throw Error('--engines accepts node and bun');
    mkdirSync(path.dirname(output), { recursive: true });
    const results = [], total = engines.length * 36;
    for (const engine of engines)
        for (const manager of ['core', 'jsonl', 'prefix'])
            for (const format of ['json', 'json5'])
                for (const input of ['text', 'bytes'])
                    for (const consumer of ['normal', 'cancel', 'queue']) {
                        const job = { engine, manager, format, input, consumer };
                        const args = [...(engine === 'node' ? ['--expose-gc'] : []), fileURLToPath(import.meta.url), '--worker', JSON.stringify(job)];
                        const workerOutput = execFileSync(engine, args, { encoding: 'utf8', timeout: 120000 });
                        const result = JSON.parse(workerOutput);
                        results.push(result);
                        writeFileSync(output, JSON.stringify(results, null, 2));
                        console.log(results.length + '/' + total, Object.values(job).join('/'), 'heap growth', result.growth1000To20000MiB.heapUsed.toFixed(3), 'MiB');
                    }
}

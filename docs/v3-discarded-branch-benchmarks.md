# Discarded branches and process CPU time

The `discarded metadata` fixture has 2,000 items. Each item has an `id` and six metadata groups containing short keys, integers, a string, booleans, null and another nested object. It serializes to 870,241 UTF-8 bytes. The `ids` mode consumes all 2,000 IDs and their concrete paths; `root` mode retains and checks the entire value.

This complements `objects/ids`: that fixture mostly needs its object keys to route the ID subscription and has no nested metadata objects whose keys can be discarded. It therefore does not isolate the cost of keys inside unused branches.

## CPU timing

`--cpu` adds seven `cpuSamplesMs` values alongside `samplesMs`. Both are milliseconds per document. CPU values sum user and system time for the worker process, including its GC threads; they are not main-thread time or CPU utilization percentages. Parallel GC can make process CPU time exceed elapsed time. CPU counters are read outside the timed document loop, and each sample still includes construction, registration, parsing and consumed results.

Wall-clock throughput remains the primary result. CPU timing helps investigate pauses or other activity: a wall-time slowdown without a similar CPU-time increase is not evidence that the parser did more work. It does not identify the cause of a pause by itself. CPU timing is optional and currently supported for Node and Bun. Deno keeps ordinary elapsed timing.

Natural GC remains the default. `--cpu` does not expose or force collection; no GC calls are added to the parser.

## Running the cases

Build the current checkout with `npm run build`. Run serially:

```sh
node scripts/v3/benchmark.mjs --engine node --format json \
  --cases 'discarded metadata/ids,discarded metadata/root' \
  --sizes 1024 --pairs 3 --warmups 1024 --iterations 256 --cpu \
  --output /tmp/discarded-node.json

node scripts/v3/benchmark.mjs --engine bun --format json \
  --cases 'discarded metadata/ids,discarded metadata/root' \
  --sizes 1024 --pairs 3 --warmups 1024 --iterations 256 --cpu \
  --output /tmp/discarded-bun.json
```

For comparisons, add `--baseline /absolute/path/to/baseline/dist/esm/v3/index.js --baseline-api callback --baseline-label baseline`. The baseline needs a separately built v3 checkout; workers alternate version order and run in fresh processes. The default comparison label/API are intended for older observable baselines, so specify both for v3.

Keep string delivery as a separate control:

```sh
node scripts/v3/benchmark.mjs --engine bun --format json --cases llm/string \
  --input bytes --chunk-unit codepoint --chunk-pattern 1,3,8,2,16,4,32,5,48,7 \
  --pairs 3 --warmups 1024 --iterations 256 --cpu \
  --output /tmp/llm-token-bun.json
```

The discarded-key prototypes motivating this fixture were not adopted: targeted improvements did not produce a sufficiently reliable tradeoff for LLM string streaming. This change adds benchmark coverage and diagnostics, with no parser optimization or public API change.

# Benchmark GC modes

The v3 benchmark uses natural garbage collection by default. It does not call GC, expose a GC function, or keep an extra parser alive. Fixture creation, chunk preparation, imports and correctness probes run before measurement; parser construction, registration, writes and end are included. Seven samples follow warmup, with results consumed and checked.

Use `--gc natural` for normal performance comparisons:

```sh
node scripts/benchmark.mjs --engine node --gc natural
node scripts/benchmark.mjs --engine bun --gc natural
```

Use `--gc forced` for a separate workload that collects between short document batches:

```sh
node scripts/benchmark.mjs --engine node --gc forced
node scripts/benchmark.mjs --engine bun --gc forced
```

The runner exposes GC only in the Node forced mode. Bun uses its GC API in that mode. Deno supports the natural mode here; the runner rejects forced mode for Deno. The selected mode is recorded in each result and in runner protocol metadata. The JSON parser itself does not call GC or require any GC flag.

Forced GC happens outside the sample timer, but its effects can extend into the sample. Node can invalidate optimized code after weak dependencies are collected, so the next batch measures JIT recovery as well as parsing. Do not describe these results as a pure cost of a state-machine dispatch instruction, or combine them with natural-GC results in one unlabelled comparison.

Reports produced before the explicit mode option used forced GC on Node/Bun. Pass `--gc forced` when reproducing their protocol; other parameters, runtime versions and commit baselines must also match. Benchmark scripts in old release checkouts have their own protocols and are not changed by this option.

For paired comparisons, build both versions, pass `--baseline /absolute/path/to/baseline/dist/esm/v3/index.js --baseline-api callback`, and set the workload, chunk sizes, warmup and iteration counts explicitly. The runner alternates baseline/candidate order and launches workers serially. Report absolute MB/s, paired changes and their variability; profiler runs are diagnostics, not substitutes for controls without instrumentation.

Core parser benchmarks default to direct text input (`--input text`). They exclude
UTF-8 decoding and stream scheduling. Explicit `--input bytes` runs measure the
decoder adapter as well and belong to separate transport diagnostics.

Current builds emit `dist/esm/index.js`. Baselines built from older 3.0 tags/PRs
may still emit `dist/esm/v3/index.js`; use that checkout's actual entry path.
2.x release checkouts emit `dist/esm/parser.js` and use
`--baseline-api observable`. The current default benchmark never selects legacy
code implicitly. `npm run benchmark` runs Node and Bun serially and forwards
workload options to both; `benchmark:node` / `benchmark:bun` select one runtime.

## Comparing with a 2.x release

The repository keeps only the current implementation. Build a release tag in a
separate checkout when a historical baseline is needed. Our original performance
baseline is `2.0.0`; choose `2.0.1` explicitly when comparing against that release.
From the current repository root:

```sh
git worktree add --detach ../json-stream-2.0.0 2.0.0
npm --prefix ../json-stream-2.0.0 ci --ignore-scripts
npm --prefix ../json-stream-2.0.0 run build
npm run build
node scripts/benchmark.mjs --baseline ../json-stream-2.0.0/dist/esm/parser.js --baseline-api observable --baseline-label 2.0.0 --engine node --input text --sizes 65536 --cases objects/ids --pairs 3
```

Use `--engine bun` for Bun. `--same-path` currently requires a callback-based 3.0
baseline and must not be used for the 2.x observable API. Results include parser
construction, consumer registration and concrete-path consumption; byte-input
comparisons also include their corresponding decoder paths.

The commands install dependencies only in the separate checkout and skip its
prepare/test hook before the explicit build. When finished, remove that clean
checkout with `git worktree remove ../json-stream-2.0.0`. No old parser is imported
by the current package or CI.

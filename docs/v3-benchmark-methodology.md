# Benchmark GC modes

The v3 benchmark uses natural garbage collection by default. It does not call GC, expose a GC function, or keep an extra parser alive. Fixture creation, chunk preparation, imports and correctness probes run before measurement; parser construction, registration, writes and end are included. Seven samples follow warmup, with results consumed and checked.

Use `--gc natural` for normal performance comparisons:

```sh
node scripts/v3/benchmark.mjs --engine node --gc natural
node scripts/v3/benchmark.mjs --engine bun --gc natural
```

Use `--gc forced` for a separate workload that collects between short document batches:

```sh
node scripts/v3/benchmark.mjs --engine node --gc forced
node scripts/v3/benchmark.mjs --engine bun --gc forced
```

The runner exposes GC only in the Node forced mode. Bun uses its GC API in that mode. Deno supports the natural mode here; the runner rejects forced mode for Deno. The selected mode is recorded in each result and in runner protocol metadata. The JSON parser itself does not call GC or require any GC flag.

Forced GC happens outside the sample timer, but its effects can extend into the sample. Node can invalidate optimized code after weak dependencies are collected, so the next batch measures JIT recovery as well as parsing. Do not describe these results as a pure cost of a state-machine dispatch instruction, or combine them with natural-GC results in one unlabelled comparison.

Reports produced before the explicit mode option used forced GC on Node/Bun. Pass `--gc forced` when reproducing their protocol; other parameters, runtime versions and commit baselines must also match. Older non-v3 benchmark scripts have their own protocols and are not changed by this option.

For paired comparisons, build both versions, pass `--baseline /absolute/path/to/baseline/dist/esm/v3/index.js --baseline-api callback`, and set the workload, chunk sizes, warmup and iteration counts explicitly. The runner alternates baseline/candidate order and launches workers serially. Report absolute MB/s, paired changes and their variability; profiler runs are diagnostics, not substitutes for controls without instrumentation.

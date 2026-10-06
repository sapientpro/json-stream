# One-pass V8 text-fragment delivery

Baseline: merged PR24/25 on main (`d7982e9`). Select a one-pass fragment method once, before the first write, only when a known V8 runtime receives text and string consumers exist. It prunes inactive matched channels while delivering the fragment. Bun, unknown browser engines and byte input retain the previous method. Consumer registration is frozen before input; reset preserves the input mode and active consumers.

Fragment boundaries, synchronous callbacks, owned paths and trailing-high-surrogate protection are unchanged. Values requested alongside fragments are still fully retained after fragment cancellation. The portable implementation remains separate to preserve its measured behavior; the two methods are covered by the same semantic checks.

## Confirmation

Full fixtures, three alternating fresh-process pairs, 256 warmups, seven samples ×64 iterations. Setup and callbacks included; chunks prepared outside timing. Variable chunks repeat `1,3,8,2,16,4,32,5,48,7` Unicode code points. Other text sizes are UTF-16 units. This models small fragments, not a measured LLM tokenizer distribution.

No heavy background load was observed before the runs. MB/s uses wall time; CPU diagnostics do not correct throughput or prove constant frequency. Pair ranges are retained, including negative controls and outliers. Inactive paths are not claimed to have exactly zero performance differences.

### v26.10.0

| workload / input | chunk | main MB/s | candidate MB/s | Δ medians | pair range |
|---|---:|---:|---:|---:|---:|
| json llm/string text | varying 1–48 code points | 149.7 | 156.2 | 4.3% | 4.3…6.9% |
| json5 llm/string text | varying 1–48 code points | 150.1 | 154.1 | 2.7% | -0.9…4.4% |
| json llm/string bytes | varying 1–48 code points | 78.0 | 75.6 | -3.0% | -3.2…3.8% |
| json5 llm/string bytes | varying 1–48 code points | 76.7 | 76.4 | -0.4% | -1.7…1.2% |
| json llm/string text | 1024 UTF-16 units | 602.4 | 617.4 | 2.5% | 1.7…2.5% |
| json5 llm/string text | 1024 UTF-16 units | 304.8 | 308.0 | 1.1% | -0.1…1.2% |
| json llm/string text | 65536 UTF-16 units | 868.2 | 867.2 | -0.1% | -2.7…2.0% |
| json5 llm/string text | 65536 UTF-16 units | 287.2 | 307.1 | 6.9% | -1.9…13.8% |
| json escapes/string text | 32 UTF-16 units | 107.9 | 109.0 | 1.1% | -0.9…4.4% |
| json escapes/string text | 1024 UTF-16 units | 341.0 | 335.5 | -1.6% | -1.6…0.6% |
| json objects/root text | 128 UTF-16 units | 129.7 | 132.2 | 2.0% | 0.4…2.6% |
| json integers/scalar text | 128 UTF-16 units | 110.1 | 109.5 | -0.5% | -1.8…-0.5% |

CPU/wall below 80%: 0/504 samples.

### v24.21.0

| workload / input | chunk | main MB/s | candidate MB/s | Δ medians | pair range |
|---|---:|---:|---:|---:|---:|
| json llm/string text | varying 1–48 code points | 129.7 | 136.0 | 4.9% | 2.7…5.5% |
| json5 llm/string text | varying 1–48 code points | 139.1 | 139.7 | 0.5% | -0.0…1.1% |

CPU/wall below 80%: 0/84 samples.

### v22.23.3

| workload / input | chunk | main MB/s | candidate MB/s | Δ medians | pair range |
|---|---:|---:|---:|---:|---:|
| json llm/string text | varying 1–48 code points | 137.8 | 145.9 | 5.9% | 5.5…7.1% |
| json5 llm/string text | varying 1–48 code points | 147.2 | 149.3 | 1.4% | 1.0…1.4% |

CPU/wall below 80%: 0/84 samples.

### 1.4.2

| workload / input | chunk | main MB/s | candidate MB/s | Δ medians | pair range |
|---|---:|---:|---:|---:|---:|
| json llm/string text | varying 1–48 code points | 225.8 | 222.0 | -1.7% | -9.0…0.5% |
| json5 llm/string text | varying 1–48 code points | 191.2 | 190.7 | -0.3% | -1.7…0.4% |

CPU/wall below 80%: 0/84 samples.

The paired JSON text gains repeat on Node22/24/26: approximately +6%/+4%/+5%. JSON5 is smaller/mixed. Node26 dense escapes/1024 text has −1.2% paired median; integers/128 text −0.9%. Bun JSON text throughput medians are negative with a wide range crossing zero. These controls remain visible; no universal regression-free claim is made.

## Rejected prototypes

Every prototype below was tested separately against main, without changing runtime sources. Three pairs, 256 warmups, seven samples ×128 iterations; variable chunks, Node26.

| prototype | JSON text paired median | JSON5 text paired median | JSON bytes paired median |
|---|---:|---:|---:|
| started-once | -0.2% | 0.9% | -0.9% |
| mode-started-once | 0.5% | 1.0% | -0.6% |
| pinned-guard | -0.1% | -1.8% | 0.3% |
| observed-only | -0.1% | 1.3% | 3.0% |
| next-guard | 0.5% | 0.4% | 1.2% |
| fused-flush | 6.2% | 1.0% | 3.5% |

One-time `_started`/input-mode stores, conditional `_pinned` reset and simpler channel guards did not give convincing gains. Unconditional fused delivery improved small JSON text in all pairs, but other inputs were mixed; the final method is selected only for V8 text input. No decoder, subscription matching or numeric parsing changes are included.

## Validation and reproduction

Build and 402 tests across 22 suites pass. Node/Bun format oracles pass 44,800 cases. An additional 4,064 baseline comparisons and 6,528 lifecycle comparisons per Node/Bun check callback cancellation, exceptions, destruction, retained roots, Unicode and input cuts. Added cancellation + surrogate-only-write + reset coverage. Compiled implementation differs from the measured prototype only in comments/formatting.

Build main separately and pass its ESM entry:

```sh
node scripts/v3/benchmark.mjs --engine node --baseline /path/to/main/dist/esm/v3/index.js --baseline-api callback --baseline-label main --cases llm/string --chunk-unit codepoint --chunk-pattern 1,3,8,2,16,4,32,5,48,7 --input text --pairs 3 --warmups 256 --iterations 64
```

Use `--runtime` for Node22/24, `--input bytes` and `--engine bun` for controls. Use `--format json5 --syntax json5` for baseline comparisons with the JSON5 scanner and syntax. Raw results and rejected prototypes remain ignored local notes. No CPU profiling tools, API, dependencies, package versions, tags or releases are added.

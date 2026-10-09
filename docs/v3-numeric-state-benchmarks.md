# Numeric parser states and direct string dispatch

Measured 2026-10-07 on ARM64 with Node 26.10.0 and Bun 1.4.2. Baseline: `ee8dbe0` (v3 before this change, not 2.0.0). Candidate: numeric state constants and a single direct STR branch before the strict JSON scanner switch. Public API and package version are unchanged.

## Protocol

Natural GC only: no exposed/forced collection or live-parser pinning. Fresh worker process per case/version/pair, serial execution, alternating version order. Each document includes parser construction, callback subscription and consumed values/concrete paths; fixture setup and correctness probing are outside the timer. Throughput is decimal MB/s. Figures below are ratios of per-version median throughputs, not paired median percentage changes.

Broad JSON: 3 pairs, 256 warmup documents, 7 timed samples × 128 documents. Tiny document control: 4096 warmups and 7 × 4096 documents. Chunk lengths refer to bytes unless text input is named. Token pattern repeats 1,3,8,2,16,4,32,5,48,7 Unicode code points, with either text or UTF-8 byte delivery.

## Broad JSON controls

| Case | Node: base → candidate MB/s | Bun: base → candidate MB/s |
|---|---:|---:|
| objects-128 | 134.1 → 137.4 (+2.5%) | 171.7 → 171.2 (-0.3%) |
| ids-128 | 138.7 → 143.2 (+3.3%) | 170.9 → 171.7 (+0.5%) |
| ids | 176.1 → 186.6 (+6.0%) | 218.6 → 220.0 (+0.6%) |
| root+ids | 137.5 → 145.6 (+5.9%) | 192.9 → 209.0 (+8.3%) |
| objects-64K | 171.0 → 182.8 (+6.9%) | 262.4 → 257.1 (-2.0%) |
| integers-root | 208.6 → 233.4 (+11.9%) | 301.1 → 324.5 (+7.8%) |
| missing | 199.7 → 213.9 (+7.1%) | 324.7 → 337.7 (+4.0%) |
| cancel | 207.7 → 234.0 (+12.7%) | 306.6 → 300.7 (-1.9%) |
| overlap | 108.4 → 113.4 (+4.6%) | 145.4 → 142.0 (-2.3%) |
| wide-nested | 134.7 → 143.6 (+6.7%) | 164.2 → 169.1 (+3.0%) |
| short-strings | 221.9 → 253.7 (+14.3%) | 344.2 → 366.9 (+6.6%) |
| decimals | 253.1 → 278.9 (+10.2%) | 409.7 → 410.4 (+0.2%) |
| tiny | 46.9 → 47.3 (+0.9%) | 47.7 → 51.4 (+7.6%) |
| llm-128 | 175.6 → 179.6 (+2.3%) | 288.7 → 286.7 (-0.7%) |
| llm-64K | 609.2 → 601.7 (-1.2%) | 404.0 → 404.3 (+0.1%) |
| llm-tokens-text | 169.6 → 174.2 (+2.7%) | 226.7 → 226.5 (-0.1%) |
| llm-tokens-bytes | 76.3 → 76.3 (-0.0%) | 122.0 → 126.6 (+3.7%) |

Tiny-input and several Bun controls have substantial between-process variation. The tiny Node control includes one anomalously slow baseline pair (+53.6% candidate comparison); do not treat the final tiny median as a stable speedup. Bun ids also varies heavily. Stable short-series Bun losses: objects/64KiB (-2.5%, -3.5%, -0.8%), cancellation (-1.6%, -2.0%, -1.9%). Overlap is mixed (-2.3%, +1.6%, -5.6%). These are recorded, not discarded.

## Longer confirmation

3 fresh process pairs, 1024 warmups, 7 samples × 512 documents, natural GC. Extended the affected LLM controls on both engines, plus Bun large-chunk objects and cancellation. Longer results are separately reported rather than replacing broad controls.

| Case | Node base → candidate MB/s | Bun base → candidate MB/s |
|---|---:|---:|
| llm-128 | 186.1 → 187.7 (+0.8%) | 289.0 → 295.2 (+2.1%) |
| llm-tokens-bytes | 76.3 → 77.7 (+1.9%) | 119.4 → 123.6 (+3.5%) |
| objects-64K | — | 267.4 → 274.5 (+2.6%) |
| cancel | — | 304.6 → 305.8 (+0.4%) |

Long paired throughput changes:

- node llm-128: +0.4%, +0.2%, +5.2%.
- node llm-tokens-bytes: +5.3%, -0.3%, +1.9%.
- bun llm-128: +7.5%, +2.7%, +0.4%.
- bun llm-tokens-bytes: +3.5%, +2.5%, +3.4%.
- bun objects-64K: +3.7%, +3.0%, -0.8%.
- bun cancel: +3.2%, -0.1%, -2.8%.

Thus the larger Bun controls do not reproduce a consistent loss in the longer series, but the shorter-series losses remain a limit of this result. This is a measured tradeoff across case/protocol/runtime, not a promise that every input becomes faster.

## JSON5 controls

2 pairs, 256 warmups (4096 for tiny), 7 × 128 documents (4096 for tiny). Inputs include comments, unquoted keys and trailing comma. JSON5 scanner receives numeric state constants, without the strict scanner's direct STR branch.

| Case | Node base → candidate MB/s | Bun base → candidate MB/s |
|---|---:|---:|
| json5-objects | 107.3 → 116.9 (+8.9%) | 97.6 → 98.3 (+0.7%) |
| json5-ids | 104.8 → 112.9 (+7.7%) | 110.5 → 111.6 (+1.0%) |
| json5-tiny | 43.3 → 47.5 (+9.7%) | 46.6 → 49.7 (+6.7%) |
| json5-llm-128 | 188.7 → 189.6 (+0.5%) | 272.5 → 268.1 (-1.6%) |
| json5-llm-tokens-bytes | 80.2 → 81.3 (+1.4%) | 123.7 → 125.7 (+1.6%) |

Bun JSON5 LLM/128 longer confirmation (3 pairs, 1024 warmups, 7 × 512): 263.1 → 262.6 (-0.2%). Paired changes: -1.9%, +1.3%, +0.1%. No consistent regression in this longer control.

## Why this shape

Replacing state imports with numeric literals alone improved scalar/structure controls but regressed escape-rich string streaming in earlier natural-GC experiments. Keep a single STR body in a direct branch and send other states through numeric dispatch. It avoids duplicating string decoding logic and retains chunk-boundary, escape, error and callback behavior.

The exact hardware cause of the earlier regression is not established. CPU sampling and disabling TurboFan inlining implicate the generated string-loop control flow; the same helpers still inline in both code shapes. Do not equate smaller machine code with faster execution.

Also tested dense numbering with STR=0 and swapping STR to 1. STR=0 actually removed the state-minus-one instruction before V8's outer jump table. Nevertheless longer controls showed mixed results: pure STR=0 LLM/128 had a -3.0% Node pair and -6.0% Bun pair; token-byte results differed by engine. Keep the original 1–13 numbering for this change. Numbering experiments are not part of the patch.

## Validation and reproduction

ESM/CJS builds, all 407 tests, 1465 additional all-split valid/error differential checks, and 22,400 JSON/JSON5 differential checks on each of Node and Bun passed.

Use the public `scripts/benchmark.mjs` with a separately built `ee8dbe0` baseline. For example, from the candidate checkout (BASELINE_MODULE is an absolute path to the baseline's dist/esm/index.js):

```sh
node scripts/benchmark.mjs --engine node --baseline "$BASELINE_MODULE" --baseline-api callbacks --baseline-label ee8dbe0 --format json --cases llm/string --sizes 128 --gc natural --pairs 3 --warmups 1024 --iterations 512
node scripts/benchmark.mjs --engine bun --baseline "$BASELINE_MODULE" --baseline-api callbacks --baseline-label ee8dbe0 --format json --cases llm/string --chunk-unit codepoint --chunk-pattern 1,3,8,2,16,4,32,5,48,7 --gc natural --pairs 3 --warmups 1024 --iterations 512
```

Other cases use the same runner's case/size/input options. Use `--format json5 --syntax json5` for the JSON5 syntax control. Experimental frozen modules and raw local profiling data remain private ignored notes; they are not required by the public runner.

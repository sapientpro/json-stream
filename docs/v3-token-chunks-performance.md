# Token-sized string writes on Bun

Stacked on PR #24 (`9bbc308`). When the previous buffer is fully consumed and the new decoded chunk is at most 128 UTF-16 units, Bun replaces it directly rather than slicing an empty remainder and concatenating the new input. Framing offsets retain their existing first branch. Partial tokens and partial escapes retain the existing carry path. The additional path is Bun-only: portable and V8 behavior remain unchanged. There is no coalescing or delayed callback delivery.

The new benchmark options distinguish Unicode code points from UTF-16 units and bytes. A deterministic variable-width sequence models small fragments; it is not a distribution measured from a specific LLM tokenizer. Code-point UTF-8 chunks preserve character boundaries, while the existing byte-sized mode still exercises split UTF-8.

## Initial full LLM fixture confirmation (before the size guard)

Mixed Ukrainian, emoji, quotes, backslashes and newlines, 3,000 repetitions. Serial alternating fresh processes, three pairs, 120 warmups, seven samples ×32 iterations, parser setup and callback consumption included. Input chunks are prepared outside the timed region. Throughput is decimal MB/s.

Pattern: `1,3,8,2,16,4,32,5,48,7` Unicode code points, repeated.

| runtime/input | PR24 MB/s | candidate MB/s | Δ medians | pair range |
|---|---:|---:|---:|---:|
| bun text | 169.0 | 227.5 | 34.6% | 29.1…35.3% |
| node text | 136.3 | 136.2 | -0.0% | -2.2…4.7% |

These runs occurred while background PHP/Chrome work was present. Repeat on quiet hardware before merging; small differences are not evidence of neutrality. The larger Bun text improvement repeated in every pair of the full fixture and earlier reduced-fixture runs, but its precise size still needs quiet confirmation.

## Initial additional Bun controls (before the size guard)

Three pairs, 120 warmups, seven samples ×32 iterations. Text chunks below are UTF-16 units, not code points. LLM control fixture here used 300 repetitions; other fixture sizes were unchanged. Same background-load limitation applies; all rows, including negative ones, are shown.

| workload | chunk units | PR24 MB/s | candidate MB/s | Δ medians | pair range |
|---|---:|---:|---:|---:|---:|
| escapes/string | 32 | 189.5 | 207.9 | 9.7% | 5.7…12.1% |
| integers/scalar | 32 | 126.9 | 135.0 | 6.4% | 5.1…14.7% |
| llm/string | 32 | 287.9 | 290.0 | 0.7% | -2.0…5.4% |
| objects/root | 32 | 148.0 | 172.2 | 16.3% | 12.6…17.8% |
| escapes/string | 1024 | 244.4 | 247.9 | 1.4% | 1.4…5.2% |
| integers/scalar | 1024 | 180.3 | 181.1 | 0.5% | -0.5…3.7% |
| llm/string | 1024 | 375.3 | 385.8 | 2.8% | 0.3…10.4% |
| objects/root | 1024 | 205.1 | 227.8 | 11.1% | 4.3…12.4% |
| escapes/string | 65536 | 154.5 | 156.7 | 1.4% | -7.0…7.7% |
| integers/scalar | 65536 | 181.0 | 180.8 | -0.1% | -1.5…5.7% |
| llm/string | 65536 | 558.0 | 579.1 | 3.8% | -3.4…8.4% |
| objects/root | 65536 | 238.1 | 246.4 | 3.5% | 3.5…6.6% |

Reduced variable-fixture UTF-8 controls were mixed (Bun pair deltas −1.0…7.7%, Node −1.5…2.5%); no stable byte-input improvement or neutral V8 performance is claimed. JSON5 uses this same core, but the performance tables above use strict JSON; JSON5 performance remains a quiet-hardware follow-up.

## Validation and rejected experiments

Build and 400 tests across 22 suites pass. Node/Bun differential format checks pass 44,800 cases. Additional baseline comparisons cover 4,064 cases per engine and 6,528 Bun cancellation/exception/destroy cases. Token-sized per-write traces match the previous parser in 112 cases per engine. New tests require delivery before the next write for JSON/JSON5 and text/UTF-8, and preserve syntax offsets after consumed Unicode chunks.

An unconditional buffer replacement did not provide stable Node benefits, so only Bun uses the new path. Removing two fragment slices gave small variable-chunk gains but regressed dense 32-unit escapes on Node by 2–3%. Shared decoder options and ASCII-terminated decoder experiments did not yield stable Node gains. A guarded Buffer decoder prototype regressed variable UTF-8 throughput about 13%. These decoder and fragment changes are excluded.

CPU samples on the variable fixture identified write/flush/scanning as major text costs and UTF-8 decoding/wrappers as major byte-input costs. Inlining and profiler overhead prevent interpreting these as exact isolated operation costs. Profiles and prototypes remain ignored local notes; no CPU tools are added to the repository.

## Reproduction

Build PR24 separately and pass its ESM entry as the baseline:

```sh
node scripts/v3/benchmark.mjs --engine bun --baseline /path/to/pr24/dist/esm/v3/index.js --baseline-api callback --baseline-label PR24 --cases llm/string --chunk-unit codepoint --chunk-pattern 1,3,8,2,16,4,32,5,48,7 --input text --pairs 3 --warmups 120 --iterations 32
```

Use `--input bytes` for separately encoded UTF-8 chunks, `--engine node` for V8 controls, or `--chunk-unit codepoint --sizes 1,8,32,48` for fixed lengths. Raw byte splits remain available through the default chunk unit and `--input bytes`. Results include chunk count and writes per second. No API, package version, tag or publication changes.

## Quiet-machine confirmation and size guard — 2026-10-06

The heavy PHP workload was absent. The original unrestricted Bun path repeated the small-text improvements (JSON +30.5%, JSON5 +29.0%) but some 64KB byte controls showed −4…7%. Those rows remain below. The final implementation therefore limits replacement to decoded chunks of at most 128 UTF-16 units; large chunks keep the existing slice/carry path. This is a size check, not buffering.

The size-limited repeat used 256 warmups and seven samples ×128 iterations, three alternating serial process pairs, full fixtures. Bun variable 1–48-code-point text measured JSON 168.9→222.9 MB/s (+32.0%), JSON5 150.3→187.4 (+24.7%). UTF-8 input measured +6.2%/+3.6%. JSON5 text and byte pair ranges were consistently positive; the JSON text run had a large first-pair outlier, retained below. No universal precise gain is claimed.

Large JSON LLM bytes became −0.2% (pair range −1.6…7.5%), large JSON5 LLM bytes −1.2% (−1.3…−0.2%), and large escaped JSON5 bytes +1.2% (−1.5…6.9%). Thus the former −4…7% result does not repeat with the guard, but a small negative JSON5 LLM control remains visible. V8 controls are also shown without a claim of exact neutrality. Process-pair variation remains even without heavy background load; CPU/wall diagnostics do not correct throughput.

### pr25-bun

90/90 workers completed

| workload / input | chunk | PR24 | PR25 | Δ | pairs |
|---|---:|---:|---:|---:|---|
| json llm/string text | varying 1–48 code points | 174.3 | 227.4 | 30.5% | 30.5%, 32.2%, 32.5% |
| json llm/string bytes | varying 1–48 code points | 116.9 | 128.8 | 10.2% | 3.5%, 2.8%, 13.5% |
| json5 llm/string text | varying 1–48 code points | 146.2 | 188.7 | 29.0% | 26.9%, 25.9%, 29.9% |
| json5 llm/string bytes | varying 1–48 code points | 112.1 | 113.2 | 1.0% | 1.0%, 0.7%, 1.0% |
| json objects/root bytes | 32 bytes | 123.6 | 124.6 | 0.8% | 0.8%, 3.8%, 1.9% |
| json objects/root bytes | 1024 bytes | 202.6 | 197.5 | -2.5% | -3.6%, 0.0%, 2.3% |
| json5 objects/root bytes | 32 bytes | 60.6 | 60.8 | 0.4% | 4.4%, -3.3%, 0.4% |
| json5 objects/root bytes | 1024 bytes | 83.4 | 83.7 | 0.3% | 0.3%, -2.2%, 0.4% |
| json integers/scalar bytes | 32 bytes | 110.8 | 113.8 | 2.7% | 2.7%, -0.5%, 2.0% |
| json integers/scalar bytes | 65536 bytes | 171.3 | 173.9 | 1.5% | 1.5%, 3.3%, -0.4% |
| json escapes/string bytes | 32 bytes | 125.7 | 123.9 | -1.4% | -3.0%, 3.1%, 2.1% |
| json escapes/string bytes | 65536 bytes | 137.7 | 137.9 | 0.1% | 0.1%, 0.8%, -5.0% |
| json llm/string bytes | 65536 bytes | 383.6 | 367.6 | -4.2% | -7.7%, -0.4%, -2.7% |
| json5 llm/string bytes | 65536 bytes | 327.8 | 314.2 | -4.2% | 0.4%, 2.6%, -7.0% |
| json5 escapes/string bytes | 65536 bytes | 87.6 | 81.6 | -6.9% | 3.3%, -5.6%, -6.9% |

CPU/wall below 80%: 0/630 samples.


### pr25-bun-limited

60/60 workers completed

| workload / input | chunk | PR24 | PR25-limited | Δ | pairs |
|---|---:|---:|---:|---:|---|
| json llm/string text | varying 1–48 code points | 168.9 | 222.9 | 32.0% | 53.1%, 25.4%, 32.0% |
| json llm/string bytes | varying 1–48 code points | 121.8 | 129.3 | 6.2% | 6.0%, 1.0%, 6.5% |
| json5 llm/string text | varying 1–48 code points | 150.3 | 187.4 | 24.7% | 26.1%, 24.6%, 26.7% |
| json5 llm/string bytes | varying 1–48 code points | 113.2 | 117.3 | 3.6% | 3.3%, 3.6%, 3.0% |
| json llm/string bytes | 65536 bytes | 397.3 | 396.3 | -0.2% | 7.5%, -0.6%, -1.6% |
| json escapes/string bytes | 65536 bytes | 144.0 | 149.6 | 3.9% | 22.5%, -1.8%, 3.9% |
| json objects/root bytes | 1024 bytes | 200.9 | 203.9 | 1.5% | 0.1%, 2.1%, 1.8% |
| json5 llm/string bytes | 65536 bytes | 332.6 | 328.7 | -1.2% | -0.2%, -1.3%, -0.5% |
| json5 escapes/string bytes | 65536 bytes | 86.5 | 87.5 | 1.2% | -1.5%, 6.9%, 1.2% |
| json5 objects/root bytes | 1024 bytes | 81.8 | 83.4 | 1.9% | 0.3%, -0.2%, 2.9% |

CPU/wall below 80%: 0/420 samples.


### pr25-node-limited

30/30 workers completed

| workload / input | chunk | PR24 | PR25-limited | Δ | pairs |
|---|---:|---:|---:|---:|---|
| json llm/string text | varying 1–48 code points | 155.8 | 155.6 | -0.1% | -2.5%, 0.8%, 1.0% |
| json llm/string bytes | varying 1–48 code points | 77.7 | 79.2 | 1.9% | 1.9%, 2.0%, 0.4% |
| json5 llm/string text | varying 1–48 code points | 163.3 | 161.8 | -1.0% | -1.0%, 0.3%, -4.3% |
| json5 llm/string bytes | varying 1–48 code points | 78.5 | 79.0 | 0.7% | -2.8%, -0.0%, 1.7% |
| json5 escapes/string bytes | 32 bytes | 67.0 | 67.2 | 0.4% | 0.4%, 4.6%, -0.7% |

CPU/wall below 80%: 0/210 samples.

# Subtree skipping after main41 rebase

Historical rebase report. PR #39 subsequently merged as `e12b3a7`; the
measurements, rejected variants and follow-up ideas below retain their original
context and are not a current merge-readiness assessment.

2026-10-09. Baseline main3ec857c, including merged PR38/40/41. PR39 was still draft during these measurements. Runtime adaptation resolves shared character-code imports and moves byte input in tests/diagnostics through createDecodedInput. Managed tails, final chunks, reset, compact and prefix/JSONL behavior are checked. Public parser API is unchanged by PR39.

## Fresh broad controls

144 serial fresh-process workers: Node26.11.0/Bun1.4.2, 3 alternating pairs × 7 samples, identical staged module path, natural GC, direct text, 128 warmups / 32 iterations. Construction, subscriptions and concrete path consumption are included. Decoding/transport scheduling is excluded.

| Runtime / format / workload / subscription / chunk UTF-16 | baseline MB/s | rebased MB/s | Δ vs main |
|---|---:|---:|---|
| node / json / discarded metadata / ids / 128 | 155.7 | 260.6 | +67.4% |
| node / json / discarded metadata / ids / 65536 | 154.5 | 274.0 | +77.4% |
| node / json / objects / missing / 65536 | 196.7 | 339.1 | +72.4% |
| node / json / objects / ids / 65536 | 169.4 | 170.1 | +0.5% |
| node / json / objects / items / 128 | 126.7 | 128.1 | +1.1% |
| node / json / objects / root / 65536 | 179.0 | 180.8 | +1.0% |
| node / json / llm / string / 32 | 230.5 | 214.0 | -7.2% |
| node / json / llm / string / 128 | 274.1 | 282.0 | +2.9% |
| node / json / escapes / string / 65536 | 485.6 | 484.5 | -0.2% |
| node / json / short strings / scalar / 128 | 160.2 | 159.1 | -0.7% |
| node / json5 / objects / root / 65536 | 144.1 | 144.9 | +0.6% |
| node / json5 / llm / string / 128 | 298.8 | 302.2 | +1.1% |
| bun / json / discarded metadata / ids / 128 | 274.0 | 451.6 | +64.8% |
| bun / json / discarded metadata / ids / 65536 | 228.7 | 477.9 | +109.0% |
| bun / json / objects / missing / 65536 | 355.6 | 680.4 | +91.4% |
| bun / json / objects / ids / 65536 | 236.6 | 245.8 | +3.9% |
| bun / json / objects / items / 128 | 171.1 | 171.7 | +0.4% |
| bun / json / objects / root / 65536 | 262.2 | 271.5 | +3.6% |
| bun / json / llm / string / 32 | 373.8 | 371.0 | -0.7% |
| bun / json / llm / string / 128 | 455.9 | 466.1 | +2.2% |
| bun / json / escapes / string / 65536 | 135.1 | 127.7 | -5.5% |
| bun / json / short strings / scalar / 128 | 203.9 | 205.6 | +0.8% |
| bun / json5 / objects / root / 65536 | 136.5 | 136.5 | -0.0% |
| bun / json5 / llm / string / 128 | 426.5 | 416.9 | -2.2% |

Metadata and no-match object gains remain substantial. Node LLM32 is −7.2% aggregate, all three paired deltas negative (−6.6%, −9.0%, −9.0%). LLM128 is positive in this particular series; neither that row nor positive root rows erase the smaller-chunk regression. Bun large escaped strings remain negative here and vary between series.

## Diagnostic controls

96 additional workers with the same serial protocol. no-skip disables validation-only entry while retaining the changed scanner and general _open. no-hook restores baseline general _open while retaining additional scanner code. Neither is an optimization candidate; source/layout changes prevent treating these as exact measurements of one conditional.

| Runtime / format / workload / subscription / chunk UTF-16 | baseline MB/s | rebased MB/s | no-skip MB/s | no-hook MB/s | Δ vs main |
|---|---:|---:|---:|---:|---|
| node / json / llm / string / 128 | 281.3 | 282.7 | 265.7 | 268.0 | +0.5% / -5.6% / -4.7% |
| node / json / escapes / string / 65536 | 481.7 | 485.8 | 491.9 | 477.0 | +0.9% / +2.1% / -1.0% |
| node / json / objects / root / 65536 | 177.7 | 182.0 | 182.6 | 180.6 | +2.4% / +2.7% / +1.6% |
| node / json / discarded metadata / ids / 65536 | 151.0 | 271.7 | 152.6 | 151.5 | +79.9% / +1.1% / +0.3% |
| bun / json / llm / string / 128 | 471.8 | 476.9 | 485.8 | 471.8 | +1.1% / +3.0% / +0.0% |
| bun / json / escapes / string / 65536 | 158.3 | 122.1 | 127.4 | 118.5 | -22.9% / -19.5% / -25.1% |
| bun / json / objects / root / 65536 | 269.4 | 267.4 | 266.6 | 261.3 | -0.8% / -1.1% / -3.0% |
| bun / json / discarded metadata / ids / 65536 | 236.3 | 472.2 | 222.9 | 231.2 | +99.8% / -5.7% / -2.2% |

Disabling actual skipping removes the large metadata gain. It does not uniformly restore string controls; scanner/code/context effects remain candidates. There is no evidence here that tree matching alone explains the regressions.

## Stable-runner experiment — rejected

90 workers, same protocol. Keep inline complete-subtree handling, resume a partial subtree through a SKIP switch case instead of replacing the instance _run method. Remove _runDiscard. This revisits the earlier switch continuation approach on the new text-only base, rather than assuming the old outcome still applies.

| Runtime / format / workload / subscription / chunk UTF-16 | baseline MB/s | rebased MB/s | stable-runner MB/s | Δ vs main |
|---|---:|---:|---:|---|
| node / json / llm / string / 32 | 225.4 | 213.2 | 210.6 | -5.4% / -6.6% |
| node / json / llm / string / 128 | 275.3 | 276.5 | 279.4 | +0.4% / +1.5% |
| node / json / discarded metadata / ids / 128 | 150.7 | 254.6 | 257.9 | +68.9% / +71.1% |
| node / json / escapes / string / 65536 | 490.4 | 487.6 | 483.0 | -0.6% / -1.5% |
| node / json / objects / root / 65536 | 180.0 | 177.8 | 177.8 | -1.2% / -1.2% |
| bun / json / llm / string / 32 | 348.9 | 368.7 | 361.8 | +5.7% / +3.7% |
| bun / json / llm / string / 128 | 466.6 | 459.0 | 461.9 | -1.6% / -1.0% |
| bun / json / discarded metadata / ids / 128 | 286.2 | 448.6 | 447.0 | +56.8% / +56.2% |
| bun / json / escapes / string / 65536 | 131.8 | 124.1 | 145.5 | -5.9% / +10.4% |
| bun / json / objects / root / 65536 | 264.2 | 263.8 | 262.8 | -0.1% / -0.5% |

Node LLM32 remains −6.6% with the stable runner, versus −5.4% for rebased in this series. The method replacement is therefore not a sufficient explanation/fix. Do not adopt this variant merely for the positive Bun escape median; other escape series have materially different modes. Correctness checks pass, but this candidate does not meet the intended performance goal. Full source snapshots remain in ignored notes.

## Sampled profile

One Node LLM32 profile per baseline/rebased: --cpu-prof-interval=100, same staged path, 512 warmups and 512 iterations × 7 samples. Profiled throughput is not used in the normal comparisons. Both execute the same number of documents. Dominant self-sampled time:

| Function | Baseline sampled ms | Rebased sampled ms |
|---|---:|---:|
| scanStringEnd json-scanner.js | 1413.6 | 1782.9 |
| write core.js | 1482.4 | 1531.6 |
| _run json-scanner.js | 1261.8 | 1343.2 |
| _flushTextChunk core.js | 1065.9 | 1126.2 |
| (garbage collector)  | 55.6 | 60.1 |

The string scan helper source is identical in both versions. The extra sampled time is largely in that helper; the validator is not a dominant sampled frame. GC is approximately 1% of each profile. This single pair narrows the next investigation to the observed-string execution/kernel context; it does not prove an inlining, tiering, hidden-class or GC cause. Raw profiles and runner are under ignored notes/analysis/v3-subtree-after-memory/main41; summaries/hashes are committed.

## Validation and next structural work

519 tests; 18,635 subtree checks each Node/Bun/Deno; 9,884 boundary checks each Node/Bun; 180 compact checks each Node/Bun; 22,400 ordinary differential checks each Node/Bun. Stable-runner additionally passes 18,635 subtree and 22,400 differential checks per Node/Bun. 32 retained-memory probes cover baseline/candidate, text/decoded bytes and end/reset/destroy/error; all stay below the diagnostic 1 MiB heap/external thresholds. GC only in those diagnostics.

1. Separate the observed-string kernel/continuation from unused-subtree execution. Validate both LLM32 and128, Unicode/escapes, metadata gains and root collectors. A separate execution lane is an unmeasured structural direction, not a promised speedup.
2. Track live descendants on the subscription trie when consumers unsubscribe, so cached contexts can become NONE. Do not revive the rejected per-context-listener design. Preserve ancestor collection and exact/Any/Rest paths; benchmark cancel-heavy streams separately from steady subscribers.
3. Validation-only root mode when there are no consumers: current _openUnobserved still creates grammar frames per descendant. Prototype selection once at entry, with strict syntax/depth/EOF/managed-tail tests and subscribed-root negative controls.

The offset/public-write cleanup is separate: private DOCUMENT_INPUT keeps the original string cursor to avoid repeated suffix slicing; the public API accepts one string. Do not mix this API restructuring into PR39 before dedicated direct-write and prefix-manager controls.

## Reproduce

Build main3ec857c separately and this branch. Run scripts/v3/benchmark.mjs with --baseline /path/to/main41/dist/esm/v3/index.js --baseline-api callback --same-path --input text --pairs 3 --warmups 128 --iterations 32 --cpu; choose --format json, --sizes 32,128 and --cases llm/string for the main regression. Other rows can be reproduced using the workload/subscription and size from the table. The complete runner, variants and intermediate raw data remain under ignored notes/analysis/v3-subtree-after-memory/main41.

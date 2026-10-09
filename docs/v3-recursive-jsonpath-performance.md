# Recursive JSONPath performance controls

Merged in PR #46 (`77fdf73`), measured 2026-10-09 on Node 26.11.0 / Bun 1.4.2. Baseline main `7d8d3b6` (#45). String-only parser; natural GC, serial fresh workers, same staged import path; 120 warmups, 7 samples × 16 documents, alternating versions. Ratios are medians of paired throughput ratios, not a ratio of independently aggregated medians.

| Run | Workload | Before MB/s | After MB/s | Change |
|---|---|---:|---:|---:|
| node | decimals/scalar | 185.0 | 185.4 | +0.3% |
| node | objects/root | 183.3 | 182.0 | -0.2% |
| node | objects/ids | 172.3 | 174.6 | +1.3% |
| node | objects/overlap | 111.1 | 108.3 | +1.1% |
| node | wide object/root | 140.9 | 143.3 | -0.5% |
| node | llm/string | 839.7 | 845.6 | +0.7% |
| bun | decimals/scalar | 281.1 | 291.3 | +3.9% |
| bun | objects/root | 259.1 | 264.2 | -1.1% |
| bun | objects/ids | 271.0 | 248.6 | -6.8% |
| bun | objects/overlap | 153.3 | 156.5 | +2.9% |
| bun | wide object/root | 177.1 | 183.5 | +4.2% |
| bun | llm/string | 395.9 | 389.2 | -2.5% |
| bun-ids-repeat | objects/ids | 250.6 | 255.3 | +0.3% |
| node-llm32 | llm/string | 233.8 | 231.1 | -1.5% |
| bun-llm32 | llm/string | 380.8 | 375.1 | -0.6% |
| node-json5 | objects/ids | 154.1 | 155.5 | -0.3% |
| node-json5 | objects/overlap | 96.2 | 96.2 | -0.5% |
| bun-json5 | objects/ids | 162.6 | 154.6 | -2.0% |
| bun-json5 | objects/overlap | 104.0 | 103.0 | -0.3% |

The first final Bun ids matrix showed -6.8%; 5 isolated repeat pairs produced +0.3% (individual pairs -3.5% to +14.7%). It is not a demonstrated persistent regression or gain. First final Bun 64KiB LLM control was -2.5%; 32-unit followup -0.6%. Node 32-unit followup is listed separately. Do not claim a performance gain from this functionality change.

## New query throughput (one checked worker run, seven samples)

| Engine | Format | Query | Chunk UTF-16 units | MB/s |
|---|---|---|---:|---:|
| node | json | `$..id` | 65536 | 167.5 |
| node | json | `$..*..id` | 65536 | 156.3 |
| node | json | `$..text` | 32 | 223.5 |
| node | json5 | `$..id` | 65536 | 150.1 |
| node | json5 | `$..*..id` | 65536 | 142.1 |
| node | json5 | `$..text` | 32 | 248.7 |
| bun | json | `$..id` | 65536 | 237.1 |
| bun | json | `$..*..id` | 65536 | 220.7 |
| bun | json | `$..text` | 32 | 391.7 |
| bun | json5 | `$..id` | 65536 | 152.1 |
| bun | json5 | `$..*..id` | 65536 | 146.7 |
| bun | json5 | `$..text` | 32 | 342.2 |

The standard controls use three version pairs; the isolated Bun IDs repeat uses
five. LLM32 rows use 32 UTF-16-unit writes; other controls use 65,536. JSON5 rows
use native JSON5 fixture syntax. New-query throughput is a one-worker absolute
measurement per engine/format/query, not a speedup against unsupported baseline
queries.

The first prototype sent terminal-only Rest through generalized recursive
transitions and slowed Node overlap by 5.2%. The merged implementation marks
suffix-bearing Rest states at registration and keeps terminal-only Rest on its
previous transition path. Scanners are unchanged. See [selector semantics](v3.md#paths-and-jsonpath).

Reproduce existing-selector controls after building the baseline separately:

```sh
node scripts/benchmark.mjs --baseline /path/to/baseline/v3/index.js --baseline-api callback --baseline-label main45 --same-path --format json --engine node --sizes 65536 --cases 'objects/ids,objects/overlap,objects/root,wide object/root,decimals/scalar,llm/string' --pairs 3 --cpu
```

Use `--engine bun` for Bun, `--sizes 32 --cases llm/string` for LLM32, and
`--format json5 --syntax json5 --cases objects/ids,objects/overlap` for JSON5.
Validation: 572 tests; independent path matcher, every split and generated trees;
Node/Bun differential, boundary, subtree and compact checks; CI Node22/24, Bun,
Deno. The checked new-query harness and raw samples remain in local ignored
`notes/analysis/recursive-jsonpath/`.

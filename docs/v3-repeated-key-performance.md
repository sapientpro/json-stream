# Repeated nested object keys

Baseline: main `195daf6` (after PR #28), before this patch. This is a paired comparison with the current v3 implementation, not the historical 2.0.0 baseline.

Strict JSON can reuse a previously validated unescaped key when both its contents and closing quote match the current input. The parser then avoids rescanning each character and creating another substring. Misses, collisions, escaped keys and incomplete keys use the existing scanner. The cache has 64 slots and stores keys of at most 64 UTF-16 units. Longer retained keys keep the ordinary path.

Allocation is lazy: only useful retained nested object keys in input windows of at least 256 UTF-16 units activate the cache. Outer object keys keep ordinary scanning. After 16 consecutive misses, ordinary scanning handles the remainder of the document; reset can reuse the bounded cache. Streaming-string parsers keep their existing scanner and do not allocate this cache. JSON5, callbacks, path ownership and wrappers are unchanged.

## Protocol

Node 26.10.0 and Bun 1.4.2 on Apple M4 Pro. All workers run serially. Three pairs of fresh processes alternate baseline/candidate order; 256 document warmups, seven samples of 32 documents, median throughput in decimal MB/s. Explicit GC between samples is outside timing. Tiny-document controls use 4096 warmups and 4096 documents per sample. Imports, fixture creation, chunk preparation and correctness checks are outside timing. Parser construction, callback registration, decoding, writes and end are timed. Ratios are throughput changes; pair ranges expose scheduling/runtime variation. CPU/wall ratios are diagnostic and do not correct MB/s.

The mixed fixture is 8000 items with id, name, active, price, tags and nested metadata (Unicode city and null note). Root retains the complete result; items emits individual items. Flat-wide has 15000 distinct keyN properties holding integers. These fixtures match the competitor comparison, but that comparison used a different warmup/sample protocol: its absolute MB/s must not be combined with these measurements.

Broad controls use the public v3 worker: its objects fixture has five fields and no metadata, its wide-object fixture has unique outer keys containing repeated id/text objects. Thus selective IDs and overlap rows below use a different dataset from the mixed root rows.

## Mixed objects and primary controls

### node

| Workload | Chunk | Baseline MB/s | Patch MB/s | Change | Pair range |
|---|---:|---:|---:|---:|---:|
| objects/root | 1024 | 148.6 | 157.5 | 6.0% | 5.7…10.4% |
| objects/root | 65536 | 156.5 | 168.4 | 7.6% | 6.6…8.5% |
| objects/items | 1024 | 134.5 | 145.2 | 8.0% | 7.8…8.5% |
| wide/root | 1024 | 146.2 | 142.9 | -2.3% | -2.3…0.0% |
| numbers/root | 65536 | 256.6 | 250.8 | -2.3% | -6.5…3.3% |
| llm/string | 1024 | 460.8 | 463.5 | 0.6% | -1.3…8.0% |

### bun

| Workload | Chunk | Baseline MB/s | Patch MB/s | Change | Pair range |
|---|---:|---:|---:|---:|---:|
| objects/root | 1024 | 179.3 | 193.3 | 7.8% | 4.7…9.3% |
| objects/root | 65536 | 190.4 | 215.5 | 13.2% | 10.0…15.3% |
| objects/items | 1024 | 204.7 | 204.0 | -0.3% | -0.3…2.5% |
| wide/root | 1024 | 168.2 | 169.5 | 0.8% | -0.8…1.1% |
| numbers/root | 65536 | 364.7 | 367.7 | 0.8% | -4.0…1.0% |
| llm/string | 1024 | 373.5 | 372.1 | -0.4% | -0.9…0.1% |

## Broad controls

### node

| Workload | Chunk | Baseline MB/s | Patch MB/s | Change | Pair range |
|---|---:|---:|---:|---:|---:|
| objects-128 | 128 | 132.2 | 132.3 | 0.0% | -1.3…1.7% |
| ids-128 | 128 | 125.4 | 126.0 | 0.5% | -0.1…0.7% |
| ids | 1024 | 144.7 | 160.9 | 11.3% | 9.5…12.5% |
| missing | 1024 | 187.5 | 186.2 | -0.7% | -1.4…-0.7% |
| cancel | 1024 | 158.5 | 158.4 | -0.1% | -2.7…1.3% |
| overlap | 1024 | 96.6 | 107.8 | 11.6% | 9.6…12.9% |
| wide-nested | 1024 | 132.6 | 139.8 | 5.4% | 5.4…6.9% |
| short-strings | 1024 | 211.2 | 214.5 | 1.5% | 0.7…1.8% |
| decimals | 65536 | 227.1 | 232.0 | 2.1% | -0.9…4.3% |
| tiny | 1024 | 25.8 | 25.8 | -0.0% | -4.1…2.4% |
| llm-128 | 128 | 166.3 | 165.8 | -0.3% | -1.7…0.6% |
| llm-64K | 65536 | 643.4 | 641.3 | -0.3% | -1.6…5.5% |
| llm-tokens-text | token pattern | 144.5 | 143.6 | -0.6% | -5.9…5.0% |
| llm-tokens-bytes | token pattern | 72.8 | 72.8 | -0.1% | -0.6…0.1% |

### bun

| Workload | Chunk | Baseline MB/s | Patch MB/s | Change | Pair range |
|---|---:|---:|---:|---:|---:|
| objects-128 | 128 | 180.7 | 178.8 | -1.1% | -5.1…3.4% |
| ids-128 | 128 | 179.7 | 175.8 | -2.2% | -6.8…3.7% |
| ids | 1024 | 198.7 | 233.8 | 17.7% | 17.7…23.4% |
| missing | 1024 | 338.6 | 343.0 | 1.3% | -0.6…1.6% |
| cancel | 1024 | 313.4 | 308.8 | -1.5% | -3.3…0.8% |
| overlap | 1024 | 137.2 | 152.8 | 11.3% | 11.2…13.1% |
| wide-nested | 1024 | 169.8 | 174.2 | 2.6% | 1.7…5.9% |
| short-strings | 1024 | 336.5 | 348.0 | 3.4% | 1.7…4.6% |
| decimals | 65536 | 419.5 | 417.9 | -0.4% | -4.3…1.8% |
| tiny | 1024 | 48.8 | 48.6 | -0.5% | -21.9…3.5% |
| llm-128 | 128 | 305.2 | 304.9 | -0.1% | -0.9…0.8% |
| llm-64K | 65536 | 390.5 | 390.8 | 0.1% | -1.7…2.1% |
| llm-tokens-text | token pattern | 230.6 | 234.3 | 1.6% | -2.0…3.2% |
| llm-tokens-bytes | token pattern | 132.8 | 132.2 | -0.4% | -0.7…0.1% |

## Longer confirmation runs

Five alternating process pairs, 1024 warmups and seven samples of 64 documents. Tiny uses 16,384 warmups and 32,768 documents per sample; its absolute throughput is not comparable to the short tiny series above because additional warmup changes optimization state. These runs target ambiguous or negative controls, without changing the candidate.

| Runtime / workload | Baseline MB/s | Patch MB/s | Change | Pair range |
|---|---:|---:|---:|---:|
| node / flat-wide-confirm | 145.7 | 146.6 | 0.6% | -2.8…4.5% |
| node / numbers-confirm | 266.5 | 260.6 | -2.2% | -8.8…6.7% |
| node / tiny-confirm | 56.6 | 55.7 | -1.7% | -2.3…6.6% |
| bun / tiny-confirm | 92.0 | 91.9 | -0.1% | -2.2…9.8% |
| bun / llm-64K-confirm | 407.3 | 405.0 | -0.6% | -5.8…4.3% |
| bun / llm-tokens-bytes-confirm | 134.4 | 133.6 | -0.6% | -5.1…3.4% |

Mixed-object root gains hold in every original pair on both runtimes; selected IDs and overlapping selectors also improve consistently. Individual-item callbacks improve on Node but are inconclusive on Bun. The wide nested-object regression of earlier prototypes is removed. Flat-wide confirmation crosses zero.

This is a workload-specific tradeoff: Node tiny documents show a possible approximately 2% cost (four of five longer pairs negative). Node integer arrays have a −2.2% aggregate result with a wide pair range; a general regression-free claim is not justified. LLM controls show no consistent large change, including token-sized UTF input; no LLM speedup is claimed. Neither whole-document JSON.parse nor string-fragment delivery was changed.

## Reproducing public controls

Build an unchanged 195daf6 checkout and pass its absolute compiled ESM entry point as the baseline. For example, from the patched checkout:

```sh
node scripts/v3/benchmark.mjs --engine node --baseline /absolute/path/to/baseline/dist/esm/v3/index.js --baseline-api callback --baseline-label 195daf6 --format json --pairs 3 --warmups 256 --iterations 32 --sizes 1024 --cases objects/ids,objects/overlap,objects/missing,'wide object/root',llm/string
```

Use `--engine bun` for Bun; vary `--sizes` for 128 or 65536 bytes. Token controls use `--cases llm/string --chunk-unit codepoint --chunk-pattern 1,3,8,2,16,4,32,5,48,7` and either `--input text` or `--input bytes`. Tiny controls use `--cases small/root --input text --warmups 4096 --iterations 4096`.

## Validation

Build and 407 tests across 23 suites pass. Native JSON/JSON5 oracle checks pass 44,800 cases across Node and Bun. Another 393,404 comparisons against 195daf6 cover raw and escaped keys, control characters, Unicode, every split of targeted inputs, key collisions/prefixes, cancellation, callback errors and reset transitions.

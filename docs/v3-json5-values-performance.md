# JSON5 cached value decisions, quoted keys and literals

Merged in PR #45 (`7d8d3b6`), measured 2026-10-09. Baseline: main f718ea4 (#44), Node 26.11.0 / Bun 1.4.2. String input only, natural GC. Serial independent workers load one version from the same staged path. Three alternating pairs, 120 warmups, 7 × 16 document iterations per worker. Correctness and concrete paths checked by the existing benchmark-worker; CPU samples recorded. Numbers are median per-pair throughput ratios; not sums of step gains. Before/after MB/s columns are independent medians, so their ratio can differ from the median paired change.

## JSON5 syntax: bare keys and comments

| Workload | Chunk | Node before → after MB/s | Node Δ | Bun before → after MB/s | Bun Δ |
|---|---:|---:|---:|---:|---:|
| decimals/missing | 65536 | 214.7 → 284.8 | +35.2% | 212.4 → 270.2 | +27.2% |
| decimals/descendants | 65536 | 211.5 → 285.1 | +34.3% | 218.1 → 271.2 | +24.4% |
| exponents/missing | 65536 | 164.5 → 221.0 | +31.0% | 154.6 → 190.2 | +23.1% |
| decimals/scalar | 65536 | 172.9 → 171.0 | -0.1% | 179.0 → 178.4 | -0.4% |
| objects/root | 65536 | 146.8 → 149.8 | +3.8% | 136.5 → 145.5 | +4.2% |
| wide object/root | 65536 | 93.9 → 95.8 | +2.0% | 83.1 → 85.9 | +2.9% |
| objects/ids | 65536 | 146.5 → 154.3 | +5.3% | 137.0 → 148.4 | +8.4% |
| literals/scalar | 65536 | 101.6 → 154.8 | +49.4% | 79.3 → 136.0 | +73.3% |
| llm/string | 32 | 244.4 → 248.1 | +0.5% | 319.5 → 322.9 | +1.9% |

## JSON syntax through JSON5: quoted keys

| Workload | Chunk | Node before → after MB/s | Node Δ | Bun before → after MB/s | Bun Δ |
|---|---:|---:|---:|---:|---:|
| decimals/missing | 65536 | 198.5 → 265.7 | +33.8% | 213.5 → 265.9 | +24.8% |
| decimals/descendants | 65536 | 200.9 → 271.4 | +34.9% | 217.4 → 267.0 | +22.9% |
| exponents/missing | 65536 | 161.7 → 211.7 | +31.1% | 151.8 → 186.1 | +22.3% |
| decimals/scalar | 65536 | 166.6 → 164.8 | -1.5% | 177.3 → 179.2 | +1.1% |
| objects/root | 65536 | 151.0 → 152.4 | +1.9% | 142.3 → 175.0 | +23.0% |
| wide object/root | 65536 | 127.8 → 132.1 | +5.2% | 135.0 → 160.3 | +23.8% |
| objects/ids | 65536 | 144.2 → 156.1 | +8.2% | 145.6 → 182.1 | +24.6% |
| literals/scalar | 65536 | 101.5 → 149.0 | +46.8% | 78.3 → 136.5 | +73.2% |
| llm/string | 32 | 236.3 → 240.4 | +0.3% | 316.1 → 318.1 | +2.8% |

## Strict JSON control: shared context change

| Workload | Chunk | Node before → after MB/s | Node Δ | Bun before → after MB/s | Bun Δ |
|---|---:|---:|---:|---:|---:|
| decimals/missing | 65536 | 307.5 → 309.8 | +0.7% | 402.2 → 405.4 | -1.5% |
| decimals/descendants | 65536 | 298.1 → 309.0 | +1.8% | 408.9 → 411.6 | +1.7% |
| exponents/missing | 65536 | 280.3 → 279.7 | +3.0% | 301.7 → 296.1 | -0.4% |
| decimals/scalar | 65536 | 181.8 → 180.6 | +1.3% | 270.5 → 274.8 | +2.0% |
| objects/root | 65536 | 175.5 → 176.7 | +2.6% | 262.4 → 252.7 | -2.1% |
| wide object/root | 65536 | 127.3 → 128.4 | +0.2% | 174.8 → 174.4 | -1.1% |
| objects/ids | 65536 | 170.4 → 168.8 | -1.3% | 244.0 → 243.5 | -0.8% |
| literals/scalar | 65536 | 145.1 → 147.3 | +0.0% | 142.1 → 141.7 | -1.9% |
| llm/string | 32 | 221.8 → 221.6 | -0.1% | 353.9 → 354.8 | -1.5% |

## Strict JSON setup controls

| Workload | Chunk | Node before → after MB/s | Node Δ | Bun before → after MB/s | Bun Δ |
|---|---:|---:|---:|---:|---:|
| scalar/root | 65536 | 5.8 → 5.8 | +0.8% | 8.3 → 8.1 | +0.4% |
| empty/root | 65536 | 3.8 → 3.7 | +0.2% | 6.9 → 6.8 | -1.9% |
| small/root | 65536 | 54.8 → 54.2 | -1.3% | 82.6 → 82.8 | +0.7% |

## Retained-root numeric controls

| Workload | Chunk | Node before → after MB/s | Node Δ | Bun before → after MB/s | Bun Δ |
|---|---:|---:|---:|---:|---:|
| decimals/root | 65536 | 202.8 → 205.8 | +0.3% | 220.1 → 218.5 | -0.2% |
| exponents/root | 65536 | 162.9 → 163.8 | +0.6% | 162.0 → 156.7 | -1.2% |


These are revision-specific measurements, not results for every later main commit.
The numeric shortcut runs only after JSON5 number syntax validation, and only if
neither a value consumer nor a retained parent needs the scalar. `hasValues` is a
conservative dispatch snapshot; it does not replace dynamic retention decisions.
Quoted keys fall back for escapes/partial input; literals verify their delimiter
before emission. No whole-document JSON.parse path is introduced.

Reproduce after building the baseline separately:

```sh
node scripts/benchmark.mjs --baseline /path/to/baseline/v3/index.js --baseline-api callback --baseline-label main44 --same-path --format json5 --syntax json5 --engine node --sizes 65536 --cases 'decimals/missing,decimals/descendants,exponents/missing,decimals/scalar,objects/root,wide object/root,objects/ids,literals/scalar' --pairs 3 --cpu
```

Use `--engine bun` for Bun, `--syntax json` for quoted JSON input through JSON5,
and `--sizes 32 --cases llm/string` for token-sized strings. Strict JSON controls
use `--format json --syntax json`. Tiny setup controls used 5,000 warmups and
20,000 iterations per sample; the retained-root numeric controls use the standard
protocol above. Validation at this revision: 536 tests, with differential,
managed-boundary, subtree and compact checks on Node and Bun.

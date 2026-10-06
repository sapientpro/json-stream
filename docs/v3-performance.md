# 3.0 candidate performance

These are historical local measurements, not release guarantees. The subscription-only API now requests complete values through `$`; the `root` workload labels below describe the older measured API. Node26.10.0/Bun1.4.2,
UTF-8 byte input, 1KiB/64KiB chunks, serial fresh processes, parser setup and
registration included. Callbacks consume concrete paths; fixture outputs are
checked. JSON fixture sizes and workload/mode definitions live in
`scripts/v3/benchmark-worker.mjs`. Reproduce a released checkout with:

```sh
node scripts/v3/benchmark.mjs --engine node --baseline /path/to/2.0.1/dist/esm/parser.js
node scripts/v3/benchmark.mjs --engine bun --baseline /path/to/2.0.1/dist/esm/parser.js
```

The broad matrix below predates input framing/reset. Three alternating process
pairs per case,160 warmups,7 samples×16 parses. Later framing screens follow.
Strict validation adds work compared with permissive 2.x, including rejecting raw
control characters. The candidate is not universally faster.

# 3.0 candidate throughput comparison

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

## node

`v26.10.0`

{"repetitions":3,"warmups":160,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | 2.0.1 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| integers/root (bytes) | 1024 | 166.3 | 155.6 | -6.4% | -8.5…-6.4% |
| integers/scalar (bytes) | 1024 | 108.7 | 96.9 | -10.9% | -11.6…-10.2% |
| decimals/scalar (bytes) | 1024 | 170.7 | 161.0 | -5.7% | -5.7…-4.5% |
| exponents/scalar (bytes) | 1024 | 126.6 | 125.2 | -1.0% | -7.4…-0.5% |
| short strings/scalar (bytes) | 1024 | 129.4 | 126.8 | -2.0% | -2.7…-0.5% |
| literals/scalar (bytes) | 1024 | 105.1 | 104.0 | -1.0% | -2.6…0.0% |
| objects/root (bytes) | 1024 | 137.9 | 145.9 | 5.8% | 4.8…12.8% |
| objects/root-callback (bytes) | 1024 | 133.4 | 142.8 | 7.0% | 7.0…9.6% |
| objects/root+ids (bytes) | 1024 | 115.6 | 116.7 | 0.9% | 0.2…2.4% |
| objects/ids (bytes) | 1024 | 110.4 | 125.5 | 13.7% | 12.1…14.2% |
| objects/items (bytes) | 1024 | 115.0 | 117.8 | 2.4% | 1.1…3.5% |
| objects/fanout (bytes) | 1024 | 106.5 | 113.0 | 6.2% | 4.7…6.9% |
| objects/overlap (bytes) | 1024 | 88.4 | 91.3 | 3.2% | 3.0…4.2% |
| objects/missing (bytes) | 1024 | 159.3 | 156.1 | -2.0% | -5.5…-1.6% |
| integers/cancel (bytes) | 1024 | 115.0 | 133.0 | 15.7% | 14.1…20.1% |
| wide object/root (bytes) | 1024 | 120.8 | 121.1 | 0.3% | -0.9…4.7% |
| unicode/string (bytes) | 1024 | 673.1 | 621.4 | -7.7% | -11.1…-5.9% |
| escapes/string (bytes) | 1024 | 147.0 | 113.0 | -23.2% | -24.1…-22.3% |
| long string/root (bytes) | 1024 | 2968.0 | 1566.8 | -47.2% | -50.2…-46.2% |
| small/root (bytes) | 1024 | 5.7 | 5.3 | -7.1% | -14.8…-3.3% |
| integers/root (bytes) | 65536 | 103.2 | 137.3 | 33.0% | 32.3…36.4% |
| integers/scalar (bytes) | 65536 | 80.4 | 93.1 | 15.8% | 8.9…19.4% |
| decimals/scalar (bytes) | 65536 | 171.1 | 161.1 | -5.9% | -14.4…-1.5% |
| exponents/scalar (bytes) | 65536 | 129.4 | 124.8 | -3.6% | -4.9…-1.9% |
| short strings/scalar (bytes) | 65536 | 118.6 | 116.1 | -2.1% | -3.2…-1.3% |
| literals/scalar (bytes) | 65536 | 104.3 | 101.2 | -3.0% | -5.3…-2.6% |
| objects/root (bytes) | 65536 | 115.5 | 116.5 | 0.9% | -2.4…2.5% |
| objects/root-callback (bytes) | 65536 | 113.2 | 113.8 | 0.6% | -1.3…5.6% |
| objects/root+ids (bytes) | 65536 | 97.8 | 100.1 | 2.3% | 0.7…3.3% |
| objects/ids (bytes) | 65536 | 95.0 | 106.0 | 11.6% | 8.3…11.9% |
| objects/items (bytes) | 65536 | 97.5 | 100.8 | 3.4% | 0.5…3.9% |
| objects/fanout (bytes) | 65536 | 92.2 | 96.0 | 4.1% | 3.8…4.3% |
| objects/overlap (bytes) | 65536 | 79.9 | 81.5 | 2.1% | 0.1…3.4% |
| objects/missing (bytes) | 65536 | 127.8 | 120.1 | -6.0% | -6.7…2.3% |
| integers/cancel (bytes) | 65536 | 88.9 | 121.6 | 36.7% | 32.7…38.3% |
| wide object/root (bytes) | 65536 | 108.4 | 106.4 | -1.9% | -7.0…1.3% |
| unicode/string (bytes) | 65536 | 1431.6 | 1242.3 | -13.2% | -14.5…-11.7% |
| escapes/string (bytes) | 65536 | 130.7 | 102.0 | -22.0% | -23.3…-19.6% |
| long string/root (bytes) | 65536 | 12838.3 | 5355.6 | -58.3% | -60.4…-52.3% |
| small/root (bytes) | 65536 | 6.5 | 5.3 | -18.5% | -19.9…-11.4% |

## bun

`1.4.2`

{"repetitions":3,"warmups":160,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | 2.0.1 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| integers/root (bytes) | 1024 | 349.1 | 361.7 | 3.6% | 3.6…5.4% |
| integers/scalar (bytes) | 1024 | 160.9 | 165.0 | 2.5% | 2.2…6.6% |
| decimals/scalar (bytes) | 1024 | 277.2 | 272.6 | -1.6% | -1.6…11.9% |
| exponents/scalar (bytes) | 1024 | 185.6 | 191.3 | 3.1% | -1.0…4.1% |
| short strings/scalar (bytes) | 1024 | 208.1 | 213.2 | 2.5% | 0.2…2.5% |
| literals/scalar (bytes) | 1024 | 128.5 | 137.3 | 6.9% | 1.6…11.0% |
| objects/root (bytes) | 1024 | 177.7 | 147.1 | -17.2% | -18.0…-13.7% |
| objects/root-callback (bytes) | 1024 | 170.1 | 172.8 | 1.6% | 0.6…4.2% |
| objects/root+ids (bytes) | 1024 | 139.8 | 154.1 | 10.3% | 1.2…10.3% |
| objects/ids (bytes) | 1024 | 148.8 | 182.2 | 22.5% | 13.2…28.9% |
| objects/items (bytes) | 1024 | 149.6 | 183.3 | 22.5% | 10.1…23.0% |
| objects/fanout (bytes) | 1024 | 97.7 | 146.7 | 50.2% | 8.9…71.2% |
| objects/overlap (bytes) | 1024 | 113.0 | 124.4 | 10.1% | 7.7…11.0% |
| objects/missing (bytes) | 1024 | 320.3 | 318.5 | -0.6% | -1.6…2.5% |
| integers/cancel (bytes) | 1024 | 176.7 | 300.0 | 69.8% | 56.2…80.7% |
| wide object/root (bytes) | 1024 | 142.5 | 124.6 | -12.6% | -14.9…-10.1% |
| unicode/string (bytes) | 1024 | 437.1 | 412.0 | -5.7% | -6.8…-3.2% |
| escapes/string (bytes) | 1024 | 202.9 | 195.8 | -3.5% | -6.0…-3.2% |
| long string/root (bytes) | 1024 | 6358.2 | 6180.6 | -2.8% | -6.8…1.2% |
| small/root (bytes) | 1024 | 12.0 | 11.7 | -2.6% | -11.3…-0.8% |
| integers/root (bytes) | 65536 | 356.7 | 379.4 | 6.3% | 1.8…8.2% |
| integers/scalar (bytes) | 65536 | 143.0 | 171.7 | 20.0% | 3.4…20.0% |
| decimals/scalar (bytes) | 65536 | 296.7 | 289.7 | -2.4% | -3.4…3.1% |
| exponents/scalar (bytes) | 65536 | 211.9 | 221.6 | 4.6% | -1.1…6.1% |
| short strings/scalar (bytes) | 65536 | 208.5 | 220.6 | 5.8% | 3.0…6.0% |
| literals/scalar (bytes) | 65536 | 136.1 | 137.2 | 0.9% | -4.5…2.5% |
| objects/root (bytes) | 65536 | 187.5 | 162.1 | -13.6% | -13.9…-13.5% |
| objects/root-callback (bytes) | 65536 | 182.3 | 177.8 | -2.5% | -3.1…-0.0% |
| objects/root+ids (bytes) | 65536 | 150.0 | 163.5 | 9.0% | 8.9…12.0% |
| objects/ids (bytes) | 65536 | 159.2 | 184.9 | 16.1% | 0.2…18.3% |
| objects/items (bytes) | 65536 | 153.9 | 178.9 | 16.2% | -3.2…16.7% |
| objects/fanout (bytes) | 65536 | 100.9 | 144.2 | 43.0% | 4.9…47.5% |
| objects/overlap (bytes) | 65536 | 118.5 | 125.8 | 6.2% | 5.7…8.1% |
| objects/missing (bytes) | 65536 | 342.0 | 344.6 | 0.8% | 0.3…6.6% |
| integers/cancel (bytes) | 65536 | 196.5 | 300.9 | 53.1% | 50.5…82.1% |
| wide object/root (bytes) | 65536 | 150.0 | 127.8 | -14.8% | -17.0…-13.3% |
| unicode/string (bytes) | 65536 | 1028.3 | 974.3 | -5.3% | -10.3…-2.4% |
| escapes/string (bytes) | 65536 | 128.5 | 132.2 | 2.9% | -3.6…6.3% |
| long string/root (bytes) | 65536 | 13022.7 | 13817.9 | 6.1% | 3.9…10.1% |
| small/root (bytes) | 65536 | 13.1 | 10.2 | -21.9% | -21.9…-9.1% |

# 3.0 candidate throughput comparison

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

## node

`v26.10.0`

{"repetitions":2,"warmups":120,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | 2.0.0 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| integers/root (bytes) | 1024 | 79.9 | 158.9 | 99.0% | 97.5…100.5% |
| decimals/scalar (bytes) | 1024 | 119.4 | 160.6 | 34.5% | 33.6…35.3% |
| short strings/scalar (bytes) | 1024 | 82.7 | 126.2 | 52.7% | 51.0…54.4% |
| literals/scalar (bytes) | 1024 | 68.3 | 104.2 | 52.6% | 52.5…52.7% |
| objects/root (bytes) | 1024 | 114.8 | 143.7 | 25.2% | 24.0…26.3% |
| objects/ids (bytes) | 1024 | 62.3 | 126.3 | 102.8% | 102.0…103.5% |
| wide object/root (bytes) | 1024 | 101.7 | 117.7 | 15.7% | 9.2…22.4% |
| unicode/string (bytes) | 1024 | 535.2 | 613.7 | 14.7% | 13.4…16.0% |
| escapes/string (bytes) | 1024 | 149.8 | 111.8 | -25.3% | -25.8…-24.9% |
| long string/root (bytes) | 1024 | 1701.6 | 1502.6 | -11.7% | -14.3…-8.8% |
| integers/root (bytes) | 65536 | 63.6 | 134.0 | 110.8% | 95.4…128.8% |
| decimals/scalar (bytes) | 65536 | 122.7 | 160.9 | 31.1% | 30.9…31.2% |
| short strings/scalar (bytes) | 65536 | 81.2 | 116.0 | 42.9% | 41.0…44.8% |
| literals/scalar (bytes) | 65536 | 67.5 | 101.9 | 51.0% | 49.9…52.1% |
| objects/root (bytes) | 65536 | 105.4 | 112.0 | 6.3% | 3.7…8.9% |
| objects/ids (bytes) | 65536 | 58.1 | 104.9 | 80.7% | 80.6…80.7% |
| wide object/root (bytes) | 65536 | 89.1 | 104.9 | 17.7% | 17.3…18.1% |
| unicode/string (bytes) | 65536 | 1412.7 | 1194.0 | -15.5% | -18.2…-12.9% |
| escapes/string (bytes) | 65536 | 121.7 | 100.7 | -17.2% | -19.1…-15.3% |
| long string/root (bytes) | 65536 | 9035.7 | 5249.5 | -41.9% | -43.8…-40.0% |

## bun

`1.4.2`

{"repetitions":2,"warmups":120,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | 2.0.0 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| integers/root (bytes) | 1024 | 45.6 | 347.1 | 661.8% | 616.1…707.6% |
| decimals/scalar (bytes) | 1024 | 94.0 | 256.6 | 172.9% | 172.1…173.7% |
| short strings/scalar (bytes) | 1024 | 58.3 | 209.1 | 258.9% | 257.6…260.2% |
| literals/scalar (bytes) | 1024 | 33.4 | 130.4 | 290.0% | 274.0…306.6% |
| objects/root (bytes) | 1024 | 143.7 | 148.8 | 3.6% | 3.4…3.8% |
| objects/ids (bytes) | 1024 | 88.3 | 174.4 | 97.4% | 96.6…98.2% |
| wide object/root (bytes) | 1024 | 122.5 | 119.0 | -2.8% | -5.2…-0.4% |
| unicode/string (bytes) | 1024 | 419.4 | 404.3 | -3.6% | -4.4…-2.8% |
| escapes/string (bytes) | 1024 | 197.4 | 190.1 | -3.7% | -5.1…-2.4% |
| long string/root (bytes) | 1024 | 6057.9 | 5878.3 | -3.0% | -3.2…-2.8% |
| integers/root (bytes) | 65536 | 50.4 | 350.4 | 595.3% | 561.1…629.3% |
| decimals/scalar (bytes) | 65536 | 96.1 | 287.0 | 198.8% | 192.5…205.2% |
| short strings/scalar (bytes) | 65536 | 59.4 | 206.1 | 246.7% | 238.4…255.5% |
| literals/scalar (bytes) | 65536 | 32.6 | 136.0 | 316.8% | 298.7…336.4% |
| objects/root (bytes) | 65536 | 147.2 | 151.4 | 2.8% | 1.7…4.0% |
| objects/ids (bytes) | 65536 | 86.9 | 191.0 | 119.9% | 106.5…133.9% |
| wide object/root (bytes) | 65536 | 124.8 | 130.2 | 4.4% | 2.0…6.8% |
| unicode/string (bytes) | 65536 | 971.9 | 953.5 | -1.9% | -8.9…6.0% |
| escapes/string (bytes) | 65536 | 134.6 | 123.3 | -8.4% | -8.8…-8.0% |
| long string/root (bytes) | 65536 | 13337.9 | 12295.2 | -7.8% | -12.3…-3.0% |

# Final record-manager comparison

Before: fresh parser/bindings per record; prefix manager repeatedly sliced the remaining input. After: validating reset with persistent channels/selector caches, offset-based prefix input, direct core write and strict JSONL UTF-8 decoding. This is an end-to-end implementation comparison, not an isolated measurement of each change.

Two alternating fresh processes per dataset/size, 12 warmups, 7 samples ×3 complete inputs; workers serial. Payload decimal MB/s excludes markers; record values/paths/fragments/counts checked. Reproduce with `node scripts/v3/benchmark-records.mjs node` and the same command with `bun`.

| engine | case | chunk | JSONL before → after MB/s | prefix before → after MB/s |
|---|---|---:|---:|---:|
| node | numbers | 1024 | 5.2 → 11.9 | 4.1 → 12.4 |
| node | objects | 1024 | 24.2 → 52.9 | 23.5 → 58.1 |
| node | unicode | 1024 | 20.3 → 38.4 | 18.2 → 39.0 |
| node | escapes | 1024 | 19.3 → 33.8 | 16.1 → 35.8 |
| node | long strings | 1024 | 798.6 → 862.5 | 775.3 → 853.8 |
| node | numbers | 65536 | 4.7 → 9.3 | 4.7 → 8.6 |
| node | objects | 65536 | 25.3 → 57.9 | 23.5 → 59.9 |
| node | unicode | 65536 | 21.1 → 53.5 | 19.6 → 39.4 |
| node | escapes | 65536 | 19.0 → 44.4 | 18.2 → 32.7 |
| node | long strings | 65536 | 1614.0 → 1719.1 | 1639.7 → 1865.7 |
| bun | numbers | 1024 | 9.9 → 21.6 | 7.0 → 23.0 |
| bun | objects | 1024 | 45.2 → 79.3 | 47.9 → 93.1 |
| bun | unicode | 1024 | 48.8 → 79.0 | 33.1 → 114.9 |
| bun | escapes | 1024 | 48.2 → 103.5 | 30.4 → 105.7 |
| bun | long strings | 1024 | 1497.1 → 1454.4 | 1549.8 → 1430.4 |
| bun | numbers | 65536 | 9.8 → 21.8 | 1.2 → 27.6 |
| bun | objects | 65536 | 60.5 → 125.9 | 12.4 → 112.2 |
| bun | unicode | 65536 | 49.3 → 99.0 | 5.9 → 110.2 |
| bun | escapes | 65536 | 47.3 → 94.3 | 5.3 → 83.3 |
| bun | long strings | 65536 | 3989.7 → 5410.2 | 2687.6 → 4047.3 |

The final ordinary-core screen follows. Bun 64KiB long-string confirmation (3 pairs,160 warmups,7×32) was +7.6%, with pair deltas -0.6…+35.9%; unstable cases do not establish a strong speedup. Prior regressions versus2.0.1 remain.

# 3.0 candidate throughput comparison

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

## node

`v26.10.0`

{"repetitions":3,"warmups":160,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | 3.0 before framing MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 1024 | 140.5 | 140.9 | 0.3% | -3.3…4.3% |
| objects/ids (bytes) | 1024 | 121.4 | 123.9 | 2.1% | 0.3…3.2% |
| long string/root (bytes) | 1024 | 1417.2 | 1484.8 | 4.8% | 0.8…5.0% |
| objects/root (bytes) | 65536 | 110.4 | 111.3 | 0.8% | -3.0…4.6% |
| objects/ids (bytes) | 65536 | 102.4 | 104.7 | 2.2% | 1.1…6.5% |
| long string/root (bytes) | 65536 | 4745.4 | 5103.3 | 7.5% | -2.2…9.9% |

## bun

`1.4.2`

{"repetitions":2,"warmups":120,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | 3.0 before framing MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 1024 | 142.7 | 143.2 | 0.4% | -0.1…0.8% |
| objects/ids (bytes) | 1024 | 160.3 | 177.0 | 10.4% | 3.1…18.1% |
| long string/root (bytes) | 1024 | 5398.9 | 5589.1 | 3.5% | -0.0…6.9% |
| objects/root (bytes) | 65536 | 131.8 | 145.9 | 10.7% | -0.8…25.3% |
| objects/ids (bytes) | 65536 | 167.7 | 172.8 | 3.0% | 1.9…4.2% |
| long string/root (bytes) | 65536 | 12301.5 | 11337.2 | -7.8% | -19.7…2.4% |

Supplementary Deno/package compatibility is verified, but Deno is not a performance gate. Remaining priorities: Node control/escape/string-fragment costs, Bun object building, tiny-document setup; preserve strict syntax, precision and owned paths.

[Escape decoding follow-up against the architecture PR](v3-escape-performance.md) adds an explicit short escaped-string workload and separate comparison/confirmation tables.


LLM-oriented `onString` measurements with 32/128/1024-byte chunks and first-delivery tests: [LLM string streaming](v3-llm-performance.md).

[Numeric materialization during emission](v3-numeric-emission-performance.md) compares the selective numeric emitter against the JSONPath subscriptions PR, including string controls and rejected runtime/dialect variants.

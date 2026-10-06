# Completed object keys

Baseline: numeric emission PR #22 (`eadf96b`). When no string-fragment subscriptions exist, strict JSON reads an unescaped key on entry, validates raw control characters, and writes a completed key directly to the object frame and current path. It avoids the extra STR dispatch and generic string completion bookkeeping. Incomplete or escaped keys continue in the existing string state with their already scanned prefix; they are not rescanned.

JSON5 and the public API are unchanged. Flattening policy, owned callback paths, object prototype protection and byte decoding remain in place. String fragment delivery changes were tested separately and not adopted because their small gains did not survive different chunk sizes/runtimes.

## Unrestricted prototype screening

Node 26.10.0 / Bun 1.4.2, UTF-8 input, serial alternating fresh processes, setup/registration included, two process pairs, 100 warmups, 24 iterations per sample, seven samples. Decimal MB/s. These initial runs use the isolated candidate; final built-package confirmation follows.

### node

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 1024 | 145.5 | 145.9 | 0.3% | -0.2…0.7% |
| objects/ids (bytes) | 1024 | 134.7 | 137.9 | 2.3% | 0.8…3.9% |
| wide object/root (bytes) | 1024 | 122.8 | 126.2 | 2.8% | 2.0…3.6% |
| llm/string (bytes) | 1024 | 240.3 | 240.7 | 0.2% | -1.2…1.6% |
| objects/root (bytes) | 65536 | 130.4 | 135.4 | 3.8% | 3.2…4.5% |
| objects/ids (bytes) | 65536 | 122.4 | 123.0 | 0.5% | -0.2…1.2% |
| wide object/root (bytes) | 65536 | 113.8 | 118.5 | 4.1% | 3.6…4.6% |
| llm/string (bytes) | 65536 | 338.3 | 349.4 | 3.3% | 3.2…3.4% |

### bun

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 1024 | 169.4 | 203.0 | 19.8% | 18.8…20.8% |
| objects/ids (bytes) | 1024 | 178.9 | 194.2 | 8.6% | 6.6…10.5% |
| wide object/root (bytes) | 1024 | 137.3 | 166.5 | 21.2% | 19.6…22.9% |
| llm/string (bytes) | 1024 | 354.8 | 351.3 | -1.0% | -2.3…0.3% |
| objects/root (bytes) | 65536 | 184.1 | 223.0 | 21.1% | 19.8…22.5% |
| objects/ids (bytes) | 65536 | 186.8 | 218.2 | 16.8% | 14.5…19.2% |
| wide object/root (bytes) | 65536 | 150.0 | 179.8 | 19.9% | 19.3…20.4% |
| llm/string (bytes) | 65536 | 382.6 | 374.1 | -2.2% | -4.7…0.3% |

## Unrestricted prototype built-package confirmation

Three process pairs, 120 warmups, 32 iterations per sample; the remaining protocol is unchanged.

### node

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 1024 | 147.7 | 152.0 | 2.9% | 0.1…4.3% |
| objects/ids (bytes) | 1024 | 138.7 | 139.8 | 0.8% | -0.4…3.8% |
| wide object/root (bytes) | 1024 | 128.0 | 133.6 | 4.4% | 3.5…5.7% |
| llm/string (bytes) | 1024 | 249.8 | 253.1 | 1.3% | -1.3…1.3% |
| objects/root (bytes) | 65536 | 135.6 | 137.5 | 1.4% | 0.2…3.7% |
| objects/ids (bytes) | 65536 | 130.8 | 132.3 | 1.2% | 0.1…4.5% |
| wide object/root (bytes) | 65536 | 123.8 | 123.4 | -0.3% | -3.7…2.7% |
| llm/string (bytes) | 65536 | 345.8 | 354.1 | 2.4% | -1.3…3.2% |

### bun

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 1024 | 174.8 | 202.0 | 15.6% | 15.6…17.4% |
| objects/ids (bytes) | 1024 | 178.3 | 191.9 | 7.6% | 6.7…9.8% |
| wide object/root (bytes) | 1024 | 140.2 | 166.8 | 19.0% | 19.0…19.6% |
| llm/string (bytes) | 1024 | 357.8 | 355.6 | -0.6% | -7.1…1.4% |
| objects/root (bytes) | 65536 | 177.4 | 224.5 | 26.6% | 24.4…29.5% |
| objects/ids (bytes) | 65536 | 203.3 | 222.3 | 9.3% | 7.0…10.6% |
| wide object/root (bytes) | 65536 | 146.0 | 180.3 | 23.4% | 20.4…24.4% |
| llm/string (bytes) | 65536 | 384.0 | 391.5 | 2.0% | -1.7…5.2% |

Bun object gains remain consistent across pairs. Node wide-object gains hold at 1024 bytes but the 65536-byte row crosses zero. LLM controls cross zero on both runtimes: throughput gains are not claimed for those controls.

## Small-chunk LLM control of the unrestricted prototype

This control rejected unconditional activation: 128-byte LLM input regressed in both runtimes. A subsequent guarded variant keeps the existing key path when fragment subscriptions are present. These rows must not be presented as acceptable final results.

### node

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| llm/string (bytes) | 32 | 79.6 | 79.4 | -0.3% | -1.2…-0.3% |
| llm/string (bytes) | 128 | 165.5 | 160.6 | -3.0% | -3.0…-0.9% |

### bun

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| llm/string (bytes) | 32 | 177.0 | 171.9 | -2.9% | -6.8…0.5% |
| llm/string (bytes) | 128 | 298.8 | 284.8 | -4.7% | -6.6…-0.2% |

## Adopted guarded implementation

Parsers with string-fragment subscriptions keep the existing key scanner path; the completed-key fast path is used by value parsers. This removes the 128-byte LLM regression while preserving the object-builder gain. Three process pairs, 120 warmups, 32 iterations, seven samples; same runtime/input/setup protocol. The measured scanner JavaScript is byte-identical to the final compiled ESM scanner.

### node

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 128 | 129.4 | 130.9 | 1.2% | -1.0…3.1% |
| wide object/root (bytes) | 128 | 118.9 | 120.7 | 1.6% | 0.9…2.2% |
| llm/string (bytes) | 128 | 166.4 | 167.4 | 0.6% | 0.6…1.1% |
| objects/root (bytes) | 1024 | 150.1 | 151.2 | 0.8% | 0.8…2.4% |
| wide object/root (bytes) | 1024 | 129.3 | 133.4 | 3.2% | -0.5…5.6% |
| llm/string (bytes) | 1024 | 253.9 | 255.3 | 0.6% | -3.3…2.1% |

### bun

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 128 | 157.0 | 178.2 | 13.5% | 11.7…15.0% |
| wide object/root (bytes) | 128 | 136.2 | 154.0 | 13.1% | 12.3…17.1% |
| llm/string (bytes) | 128 | 299.4 | 303.0 | 1.2% | -1.8…6.2% |
| objects/root (bytes) | 1024 | 175.3 | 205.3 | 17.1% | 12.9…19.0% |
| wide object/root (bytes) | 1024 | 145.4 | 169.3 | 16.4% | 15.5…20.4% |
| llm/string (bytes) | 1024 | 357.8 | 358.8 | 0.3% | -0.2…10.5% |

## Additional guarded controls

Two process pairs with the final built package, 120 warmups and 32 iterations. Includes small LLM chunks and large input chunks; all negative rows remain visible.

### node

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 32 | 93.6 | 94.8 | 1.2% | -0.4…2.8% |
| objects/ids (bytes) | 32 | 92.5 | 92.9 | 0.4% | 0.4…0.4% |
| wide object/root (bytes) | 32 | 85.5 | 86.0 | 0.5% | -1.6…2.8% |
| llm/string (bytes) | 32 | 77.9 | 79.1 | 1.5% | -0.5…3.7% |
| objects/root (bytes) | 65536 | 135.9 | 133.2 | -2.0% | -4.5…0.6% |
| objects/ids (bytes) | 65536 | 131.8 | 134.5 | 2.1% | 1.3…2.8% |
| wide object/root (bytes) | 65536 | 121.7 | 124.6 | 2.4% | 1.4…3.5% |
| llm/string (bytes) | 65536 | 355.5 | 354.9 | -0.2% | -0.6…0.3% |

### bun

| workload | chunk | PR22 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 32 | 113.3 | 123.2 | 8.7% | 8.0…9.4% |
| objects/ids (bytes) | 32 | 123.7 | 128.1 | 3.5% | 2.6…4.4% |
| wide object/root (bytes) | 32 | 108.2 | 115.0 | 6.3% | 4.1…8.6% |
| llm/string (bytes) | 32 | 180.2 | 179.6 | -0.3% | -1.0…0.3% |
| objects/root (bytes) | 65536 | 185.8 | 225.7 | 21.5% | 20.1…22.9% |
| objects/ids (bytes) | 65536 | 191.4 | 219.6 | 14.8% | 14.7…14.9% |
| wide object/root (bytes) | 65536 | 148.0 | 179.4 | 21.2% | 18.9…23.6% |
| llm/string (bytes) | 65536 | 381.0 | 384.0 | 0.8% | -4.0…5.6% |

## Validation

Build and 387 tests across 20 suites pass. Node and Bun pass 44,800 JSON/JSON5 differential cases. Another 22,890 comparisons per runtime check long/escaped/Unicode keys and all 32 invalid raw control characters across input boundaries against the unchanged #22 baseline. Node, Bun and Deno smoke checks include wrappers, framing and streamed strings.

CPU/wall ratios are only a scheduling diagnostic. They neither correct throughput nor track CPU frequency. Small deltas crossing zero are not established improvements.

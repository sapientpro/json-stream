# Native decoding of strict JSON string fragments

Baseline: `3.0.0-alpha.1` (`1b61ea8`). Within the existing V8 escape-run path, find a lexically complete string fragment of at least 256 source units, wrap it in quotes and decode it with `JSON.parse`. This parses one primitive string; document structure and selectors remain incremental. The existing 64-decoded-unit / 256-remaining-source-unit entry gate remains in place. JSON5, Bun, unknown browser engines and small chunks keep their previous decoding paths.

Escaped quotes are distinguished from closing quotes by backslash-run parity. An odd trailing backslash or incomplete Unicode escape is left for the ordinary incremental decoder. Malformed fragments fall back to that decoder so public errors and offsets remain consistent. Root retention, synchronous fragment delivery, owned paths, cancellation and surrogate protection are unchanged.

`JSON.parse` requires valid JSON and cannot extend its grammar; the synthetic quoted fragment must be complete. [ECMAScript JSON.parse specification](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.parse).

## Initial experiment and suffix correction

The initial native prototype improved Node LLM throughput by 37%/80% at 1024/65536 bytes but regressed dense escaped fragments at 1024 bytes by 10%. Parsing incomplete suffixes incurred exceptions before falling back. Trimming incomplete suffixes avoids that cost: 2,079 valid-input boundary probes exercised 1,976 native calls with zero parse failures.

## Repeated Node 26 measurement

UTF-8 input, decimal MB/s, serial alternating fresh processes, setup and callbacks included; three pairs, 120 warmups, 64 iterations, seven samples. The measured JavaScript is byte-identical to the compiled scanner.

| workload | chunk | alpha.1 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| escapes/string (bytes) | 128 | 97.4 | 97.7 | 0.3% | -1.6…0.6% |
| llm/string (bytes) | 128 | 173.2 | 170.4 | -1.6% | -1.6…0.6% |
| escapes/string (bytes) | 1024 | 142.3 | 259.5 | 82.4% | 82.4…84.9% |
| llm/string (bytes) | 1024 | 270.0 | 403.1 | 49.3% | 43.3…53.0% |
| escapes/string (bytes) | 65536 | 159.2 | 382.2 | 140.1% | 129.3…142.9% |
| llm/string (bytes) | 65536 | 355.7 | 649.9 | 82.7% | 78.8…86.1% |

## Long ASCII controls

Three pairs, 256 warmups, 512 iterations per sample to give these fast parses longer measurement windows. The native escape path does not run on this workload.

| workload | chunk | alpha.1 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| long string/root (bytes) | 1024 | 1853.8 | 1843.1 | -0.6% | -0.6…18.8% |
| long string/root (bytes) | 65536 | 5088.4 | 5070.6 | -0.3% | -2.1…1.6% |

## Additional controls under background CPU load

The following Node 26 small-chunk, Bun and Node 24 runs overlapped heavy background PHP work. Process-pair ranges reached 40–72%; eleven Bun samples had CPU/wall below 80%. These are recorded for transparency and **are not evidence of neutral controls or precise performance gains**. CPU/wall cannot detect frequency changes and is not a throughput correction. Repeat small-chunk/object/Bun controls on quiet hardware before merging. A further repeat was stopped when the background workload restarted.

### node `v26.10.0`

| workload | chunk | alpha.1 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| short strings/scalar (bytes) | 32 | 100.6 | 100.8 | 0.2% | -6.1…0.6% |
| objects/root (bytes) | 32 | 88.0 | 84.6 | -3.9% | -25.7…-2.4% |
| llm/string (bytes) | 32 | 75.2 | 75.7 | 0.7% | -1.7…2.4% |
| short strings/scalar (bytes) | 128 | 133.9 | 131.9 | -1.5% | -4.1…-1.5% |
| objects/root (bytes) | 128 | 115.7 | 117.1 | 1.1% | 0.5…12.6% |
| llm/string (bytes) | 128 | 157.1 | 157.9 | 0.5% | -0.5…40.3% |

### bun `1.4.2`

| workload | chunk | alpha.1 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/root (bytes) | 128 | 161.4 | 159.0 | -1.4% | -15.7…2.9% |
| escapes/string (bytes) | 128 | 110.2 | 104.6 | -5.1% | -5.1…35.7% |
| llm/string (bytes) | 128 | 228.6 | 238.9 | 4.5% | 2.4…72.5% |
| objects/root (bytes) | 1024 | 183.1 | 176.9 | -3.4% | -4.1…-1.3% |
| escapes/string (bytes) | 1024 | 155.8 | 170.2 | 9.2% | -1.5…9.2% |
| llm/string (bytes) | 1024 | 302.4 | 305.0 | 0.9% | 0.4…2.5% |

### node `v24.21.0`

| workload | chunk | alpha.1 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| escapes/string (bytes) | 1024 | 110.7 | 217.1 | 96.1% | 86.4…105.8% |
| llm/string (bytes) | 1024 | 218.3 | 334.8 | 53.4% | 29.1…77.3% |
| escapes/string (bytes) | 65536 | 121.2 | 362.8 | 199.4% | 187.8…213.1% |
| llm/string (bytes) | 65536 | 279.7 | 634.3 | 126.8% | 120.5…133.5% |

## Validation and reproduction

Build and 394 tests across 21 suites pass, including every UTF-8 cut through a large escaped value, root retention, owned fragment paths, cancellation, malformed/truncated suffixes and destruction. Node/Bun format oracles pass 44,800 cases. Additional checks compare 20,700 large-string cases and 6,528 fragment lifecycle cases against the frozen alpha baseline. Installed-package smoke checks cover Node 22/24, Bun and Deno, including CommonJS exports.

Build the alpha tag in a separate checkout and pass its compiled ESM entry as the baseline:

```sh
node scripts/v3/benchmark.mjs --baseline /path/to/alpha/dist/esm/v3/index.js --baseline-api callback --baseline-label alpha.1 --cases llm/string,escapes/string --sizes 128,1024,65536 --pairs 3 --warmups 120 --iterations 64
```

No CPU profiling tools, runtime dependencies, release or publication are added by this change.

## Quiet-machine confirmation — 2026-10-06

The heavy PHP workload was absent for this repeat. Full fixtures, three serial alternating process pairs, 120 warmups and seven samples ×32 iterations. The initial control table remains above as historical loaded-hardware data. All repeated rows below are retained; CPU/wall diagnostics do not correct throughput or prove constant CPU frequency.

The native gains repeat: Node LLM 1KB/64KB +46.6%/+75.8%, dense escaped strings +80.7%/+144.8%. Small-string, numeric and Bun controls mostly show small differences. Node object/128-byte input is −2.2% initially and −2.4% in the longer repeat (pair range −2.4…4.8%); do not claim universally neutral controls.

The first fast-ASCII controls were −4…5%. Longer windows used 256 warmups and seven samples ×512 iterations for ASCII, ×128 for objects/LLM. ASCII/64KB then measured +0.2%, range 0.0…2.6%; ASCII/1KB had a 41.6% process-pair outlier. LLM/32 bytes also had a 23.1% pair outlier. Those outliers remain visible and are not interpreted as gains.

### pr24-node

84/84 workers completed

| workload / input | chunk | alpha.1 | PR24 | Δ | pairs |
|---|---:|---:|---:|---:|---|
| json llm/string bytes | 32 bytes | 84.0 | 83.6 | -0.5% | 0.0%, -0.9%, -3.3% |
| json llm/string bytes | 128 bytes | 168.6 | 172.3 | 2.2% | 2.7%, 0.4%, 1.7% |
| json llm/string bytes | 1024 bytes | 262.2 | 384.3 | 46.6% | 47.4%, 46.6%, 49.2% |
| json llm/string bytes | 65536 bytes | 365.0 | 641.8 | 75.8% | 78.5%, 78.8%, 75.7% |
| json escapes/string bytes | 128 bytes | 95.1 | 95.1 | -0.1% | -1.6%, -1.6%, -0.1% |
| json escapes/string bytes | 1024 bytes | 140.0 | 253.1 | 80.7% | 80.8%, 82.0%, 80.7% |
| json escapes/string bytes | 65536 bytes | 161.5 | 395.3 | 144.8% | 139.0%, 147.1%, 142.3% |
| json short strings/scalar bytes | 32 bytes | 99.1 | 99.5 | 0.5% | 1.8%, 0.1%, -0.4% |
| json short strings/scalar bytes | 128 bytes | 134.3 | 134.3 | -0.1% | 0.4%, 0.1%, -0.9% |
| json objects/root bytes | 32 bytes | 96.1 | 96.3 | 0.3% | 1.1%, -0.1%, -0.6% |
| json objects/root bytes | 128 bytes | 134.7 | 131.7 | -2.2% | 0.1%, -3.5%, -3.3% |
| json integers/scalar bytes | 128 bytes | 103.5 | 104.3 | 0.8% | 0.8%, 0.1%, 0.2% |
| json long string/root bytes | 1024 bytes | 1786.6 | 1713.5 | -4.1% | -4.1%, -2.7%, -0.7% |
| json long string/root bytes | 65536 bytes | 5334.5 | 5073.3 | -4.9% | -13.7%, 0.1%, -4.1% |

CPU/wall below 80%: 0/588 samples.


### pr24-bun

36/36 workers completed

| workload / input | chunk | alpha.1 | PR24 | Δ | pairs |
|---|---:|---:|---:|---:|---|
| json llm/string bytes | 128 bytes | 282.5 | 287.9 | 1.9% | 1.9%, -1.8%, 1.5% |
| json llm/string bytes | 1024 bytes | 350.3 | 351.7 | 0.4% | -0.4%, 0.4%, 3.9% |
| json escapes/string bytes | 128 bytes | 164.7 | 165.9 | 0.8% | 4.1%, -2.2%, -1.7% |
| json escapes/string bytes | 1024 bytes | 192.0 | 194.3 | 1.2% | 2.7%, 1.2%, -1.6% |
| json objects/root bytes | 128 bytes | 177.3 | 179.0 | 1.0% | 3.5%, -0.1%, 1.0% |
| json objects/root bytes | 1024 bytes | 201.0 | 200.1 | -0.4% | -1.9%, 4.6%, -2.5% |

CPU/wall below 80%: 0/252 samples.


### pr24-node-extended

24/24 workers completed

| workload / input | chunk | alpha.1 | PR24 | Δ | pairs |
|---|---:|---:|---:|---:|---|
| json long string/root bytes | 1024 bytes | 2061.6 | 2115.1 | 2.6% | 1.5%, 2.8%, 41.6% |
| json long string/root bytes | 65536 bytes | 5775.4 | 5787.7 | 0.2% | 0.0%, 0.2%, 2.6% |
| json objects/root bytes | 128 bytes | 136.7 | 133.3 | -2.4% | -2.3%, -2.4%, 4.8% |
| json llm/string bytes | 32 bytes | 70.3 | 86.5 | 23.1% | -0.8%, 23.1%, -3.7% |

CPU/wall below 80%: 0/168 samples.


# Two-part copying comparison

The current opt-in facade joins two nonempty pieces instead of splitting the output into individual code units. All variants below use the same main core (`16a3d15`, PR40), independent of PR41. The default entry does not import the facade. Thresholds remain 65,536 input UTF-16 units and 128 output units.

144 serial fresh-process workers, natural GC, three alternating-order repetitions, seven samples of 16 parses, 64 warmups. Same staged module path for all versions; direct string input excludes decoding and stream scheduling. JSON5 workloads include JSON5 syntax. Setup, callbacks, concrete paths and EOF included; output content checked. Values are decimal MB/s, medians of worker medians. Paired deltas and CPU throughput are separate statistics.

| Runtime | Format | Case | UTF16 chunk | Plain | Old split/join | Two-part join | vs old | Paired range | Median paired CPU Δ |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| node26 | json | short strings/scalar | 65536 | 164.7 | 71.0 | 91.9 | +29.4% | +29.4…+31.2% | +30.5% |
| node26 | json | llm/string | 32 | 223.2 | 217.6 | 218.2 | +0.3% | -0.4…+0.5% | -0.9% |
| node26 | json5 | short strings/scalar | 65536 | 160.7 | 72.3 | 93.6 | +29.5% | +28.7…+30.5% | +28.9% |
| node26 | json5 | llm/string | 32 | 235.3 | 235.2 | 230.4 | -2.0% | -2.2…-0.8% | -1.6% |
| bun | json | short strings/scalar | 65536 | 215.9 | 85.2 | 111.7 | +31.2% | +28.9…+40.8% | +31.9% |
| bun | json | llm/string | 32 | 353.7 | 341.7 | 351.4 | +2.8% | -0.1…+3.7% | +2.3% |
| bun | json5 | short strings/scalar | 65536 | 204.2 | 85.4 | 112.6 | +31.9% | +29.2…+51.5% | +25.4% |
| bun | json5 | llm/string | 32 | 311.6 | 310.3 | 308.3 | -0.6% | -8.2…+2.6% | -0.4% |
| v24.21.0 | json | short strings/scalar | 65536 | 156.3 | 70.1 | 93.6 | +33.5% | +31.2…+34.3% | +32.0% |
| v24.21.0 | json | llm/string | 32 | 185.2 | 177.7 | 179.8 | +1.2% | -0.7…+1.2% | -0.9% |
| v24.21.0 | json5 | short strings/scalar | 65536 | 160.2 | 71.8 | 95.1 | +32.4% | +31.6…+34.7% | +32.2% |
| v24.21.0 | json5 | llm/string | 32 | 198.0 | 195.4 | 192.3 | -1.6% | -4.3…-0.2% | -1.9% |
| v22.23.3 | json | short strings/scalar | 65536 | 140.8 | 69.5 | 88.8 | +27.7% | +21.6…+28.9% | +24.8% |
| v22.23.3 | json | llm/string | 32 | 193.9 | 190.2 | 195.9 | +3.0% | +3.0…+4.0% | +3.4% |
| v22.23.3 | json5 | short strings/scalar | 65536 | 148.4 | 72.4 | 91.2 | +26.0% | +25.4…+28.4% | +27.1% |
| v22.23.3 | json5 | llm/string | 32 | 218.2 | 222.5 | 219.2 | -1.5% | -1.5…-0.1% | -0.3% |

Dense short-string selections improve by 26–34% against the old copy primitive across Node 22/24/26 and Bun, JSON/JSON5. They remain substantially slower than plain parsing: copying is still opt-in. LLM/32 controls do not activate copying at the default input threshold; forwarding overhead and code-layout/GC variability remain visible. Do not present differences in those controls as reduced parsing work. Node JSON5 LLM/32 medians are 1.5–2.0% below the old facade, with all three paired changes negative on each Node version; this remains a draft follow-up, not a hidden neutral result.

48 current retained-memory probes cover both formats, text/byte input and scalar/fragment outputs, with four 8 MiB ignored payloads and four short saved results. Forced GC is diagnostic-only. Two-part copying releases the parent-size storage on both runtimes, like the old implementation. Bun heap/external counters overlap and must not be added. This measures retained memory, not peak/RSS.

| Runtime | Variant | Worst retained heap MiB | Worst external MiB |
|---|---|---:|---:|
| node | plain | 64.134 | 32.000 |
| node | split | 0.144 | 0.000 |
| node | join | 0.144 | 0.000 |
| bun | plain | 64.193 | 64.132 |
| bun | split | 0.211 | 0.142 |
| bun | join | 0.213 | 0.144 |

Caching length was also tested separately: 60 fresh workers, 5 pairs, 3 sizes, Node 26/Bun. There is no consistent speedup across sizes and repeats. Local length is used for readability, not as a claimed optimization.

[Complete current timing/memory/length samples and source hashes](../benchmarks/v3-copying-data/two-part-join.json). [API and reproduction](v3-copying.md).

Earlier exploratory measurements on PR41 covered LLM chunks of 8/32/128/65536 units, sparse outputs, root/item controls and lifecycle memory cases. Those are a different core revision and are preserved in excluded notes/analysis/v8-copy-parser; they are not pooled with the main-based matrix above.

---

## Historical split/join copying measurements

These observations describe the original `split('').join('')` prototype, not
the current two-part implementation. The updated comparison is below.


The optional module is intended for sparse short outputs from large sources.
These are measured tradeoffs, not default-parser speed improvements. Existing
parser modules were byte-identical to alpha.2 at that revision; only the opt-in facade adds copying.

Node 26.10.0 and Bun 1.4.2, strict JSON, three rotating fresh-process pairs,
128 warmups, seven samples of 32 parses each, natural GC, serial workers. Input
sizes are UTF-16 units for text and bytes for encoded input. Setup and callback
consumption are included. Both entries import exactly the same scanner files.
All 192 timing workers validate output content; selected-value and string cases
consume concrete paths. Each throughput
number is the median of three worker medians; paired ranges show all pairs.
Positive differences in a forwarding wrapper are observations, not a claim that
copying reduces parsing work. Results can vary with JIT and allocation behavior.

LLM 128 changes ranged from −2.4% to +2.9% across the four engine/input medians.
Dense short-scalar selections at 65536 units/write cost 56–59% in this run: copying
40,000 short values is expensive. This is why the module is opt-in and aimed at
sparse results, while ordinary small-chunk LLM parsing keeps the default API.

[Full timing samples and 32+64 memory diagnostics](../benchmarks/v3-copying-data/measurements.json).
[API, policy, memory findings and reproduction](v3-copying.md).

## Node, text

| Workload | Input units/write | Ordinary MB/s | Copying MB/s | Observed change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| short strings/scalar | 128 | 165.9 | 160.0 | -3.6% | -7.0…-2.3% |
| objects/root | 128 | 143.8 | 144.7 | +0.7% | -0.0…+1.9% |
| objects/items | 128 | 135.1 | 134.6 | -0.4% | -0.4…+0.1% |
| llm/string | 128 | 297.7 | 290.7 | -2.4% | -2.4…-1.5% |
| short strings/scalar | 65536 | 172.1 | 75.3 | -56.3% | -56.3…-54.9% |
| objects/root | 65536 | 191.4 | 188.9 | -1.3% | -3.9…+6.8% |
| objects/items | 65536 | 158.4 | 156.9 | -0.9% | -0.9…-0.2% |
| llm/string | 65536 | 881.5 | 870.7 | -1.2% | -2.3…-1.1% |

## Node, bytes

| Workload | Input units/write | Ordinary MB/s | Copying MB/s | Observed change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| short strings/scalar | 128 | 169.9 | 165.4 | -2.7% | -4.3…-1.6% |
| objects/root | 128 | 145.5 | 145.8 | +0.2% | -2.8…+1.8% |
| objects/items | 128 | 135.5 | 135.4 | -0.0% | -0.5…+0.3% |
| llm/string | 128 | 189.0 | 188.4 | -0.3% | -3.2…+1.2% |
| short strings/scalar | 65536 | 189.6 | 79.0 | -58.3% | -59.2…-56.8% |
| objects/root | 65536 | 193.8 | 197.3 | +1.8% | -2.6…+1.8% |
| objects/items | 65536 | 176.6 | 175.2 | -0.8% | -2.8…+1.1% |
| llm/string | 65536 | 638.7 | 626.9 | -1.8% | -5.9…+4.0% |

## Bun, text

| Workload | Input units/write | Ordinary MB/s | Copying MB/s | Observed change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| short strings/scalar | 128 | 208.7 | 203.9 | -2.3% | -7.1…+0.5% |
| objects/root | 128 | 195.7 | 200.4 | +2.4% | +1.2…+6.0% |
| objects/items | 128 | 170.8 | 168.5 | -1.3% | -1.9…+0.5% |
| llm/string | 128 | 474.9 | 488.7 | +2.9% | -2.2…+5.8% |
| short strings/scalar | 65536 | 217.8 | 89.3 | -59.0% | -60.8…-57.0% |
| objects/root | 65536 | 267.1 | 267.1 | -0.0% | -2.9…+4.6% |
| objects/items | 65536 | 221.4 | 220.3 | -0.5% | -4.7…+11.9% |
| llm/string | 65536 | 415.6 | 391.0 | -5.9% | -5.9…+5.1% |

## Bun, bytes

| Workload | Input units/write | Ordinary MB/s | Copying MB/s | Observed change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| short strings/scalar | 128 | 193.2 | 194.6 | +0.7% | -7.0…+2.3% |
| objects/root | 128 | 190.5 | 181.9 | -4.5% | -10.9…-1.4% |
| objects/items | 128 | 164.8 | 165.7 | +0.6% | -0.8…+8.1% |
| llm/string | 128 | 291.5 | 298.0 | +2.2% | -4.7…+6.0% |
| short strings/scalar | 65536 | 218.3 | 90.9 | -58.3% | -58.6…-57.0% |
| objects/root | 65536 | 274.4 | 278.1 | +1.4% | -1.9…+5.2% |
| objects/items | 65536 | 222.4 | 244.4 | +9.9% | +3.3…+13.5% |
| llm/string | 65536 | 390.7 | 401.3 | +2.7% | +2.7…+10.1% |

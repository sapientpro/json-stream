# Streaming package comparison, 3.0 alpha

Measured on 2026-10-08; recorded parser source revision `e1d2d41`, on Apple M4 Pro.
Pinned versions: our 3.0.0-alpha.1, @streamparser/json 0.0.26, stream-json 3.7.0,
json-web-streams 1.2.0. JSON only in these throughput tables; JSON5 and record-manager
capabilities are listed in [the capability matrix](../benchmarks/capabilities.md).

## Protocol and interpretation

All throughput runs use natural GC, serial fresh workers, and 3 rotating
package orders. Each worker checks full root contents or selected items/fragments
before timing, warms up 12 parses, then takes seven samples of 4 parses. Tiny
documents use 512 warmups and 128 parses/sample. Cells are medians of the 3
worker medians in **decimal MB/s**, including parser construction, subscriptions,
byte decoding and input feeding. Raw files preserve individual wall and process
CPU samples; the tables use wall time. No GC call occurs in this harness or the parser.

Text chunk sizes count UTF-16 units; byte chunk sizes count UTF-8 bytes. Both use
the UTF-8 document byte size for MB/s. Fixtures and prepared chunks are identical
between packages within each row. Results describe these public API adapters, not
a universal package ranking. Small differences and cold-worker variation need
confirmation before changing runtime code. See raw sample ranges before treating
a close result as a win.

- **Root:** materialize one complete value.
- **Items:** materialize and consume each `$.items[*]` object, without retaining the root.
- **String:** consume decoded text before string completion. Our callbacks and
  stream-json tokens deliver independent fragments. **@streamparser/json delivers
  cumulative previews**, so its string column is a different delivery contract.
- stream-json uses its public synchronous core, assembler, pick and streamArray
  components. Its string adapter consumes stringChunk tokens; these fixtures have
  only one string value, so no extra path-filter pipeline is needed.
- json-web-streams includes Web scheduling and TextDecoderStream for byte input.
  It has no corresponding independent-fragment API; unsupported is not zero speed.
- json-stream-lite is excluded from ongoing comparisons as requested. JSON.parse
  is not ranked as a streaming alternative.

## Results

### node

`v26.10.0`; 38 scenarios, 456 workers: 426 valid, 30 unsupported, 0 failed.

| Workload | Input / chunk | Ours | @streamparser/json | stream-json | json-web-streams |
|---|---|---:|---:|---:|---:|
| ascii / root | text / 1,024 | 2365.1 | 846.8 | 838.3 | 414.1 |
| ascii / root | bytes / 1,024 | 1871.6 | 1229.0 | 700.0 | 471.8 |
| unicode / root | text / 1,024 | 2884.6 | 65.4 | 1635.3 | 660.2 |
| unicode / root | bytes / 1,024 | 776.4 | 65.0 | 599.2 | 380.7 |
| escapes / root | text / 1,024 | 578.1 | 37.3 | 68.7 | 312.6 |
| escapes / root | bytes / 1,024 | 566.2 | 38.5 | 65.8 | 320.6 |
| numbers / root | text / 1,024 | 196.0 | 56.4 | 102.8 | 304.3 |
| numbers / root | bytes / 1,024 | 239.5 | 58.4 | 99.8 | 292.6 |
| decimals / root | text / 1,024 | 174.0 | 69.4 | 173.4 | 243.2 |
| decimals / root | bytes / 1,024 | 217.4 | 71.5 | 165.7 | 268.2 |
| literals / root | text / 1,024 | 197.4 | 167.5 | 77.0 | 327.6 |
| literals / root | bytes / 1,024 | 217.3 | 190.2 | 73.2 | 338.0 |
| short strings / root | text / 1,024 | 234.0 | 74.6 | 161.1 | 231.4 |
| short strings / root | bytes / 1,024 | 282.6 | 81.1 | 193.8 | 239.8 |
| wide / root | text / 1,024 | 117.5 | 55.3 | 89.3 | 141.2 |
| wide / root | bytes / 1,024 | 127.5 | 56.6 | 89.3 | 142.4 |
| empty / root | text / 1,024 | 87.9 | 54.2 | 35.2 | 126.0 |
| empty / root | bytes / 1,024 | 89.7 | 57.4 | 37.7 | 139.7 |
| nested / root | text / 1,024 | 47.0 | 34.6 | 23.8 | 56.2 |
| nested / root | bytes / 1,024 | 46.6 | 39.8 | 25.5 | 56.1 |
| tiny / root | text / 1,024 | 28.3 | 23.0 | 31.6 | 5.8 |
| tiny / root | bytes / 1,024 | 25.3 | 26.2 | 33.2 | 3.6 |
| objects / root | text / 1,024 | 152.3 | 65.2 | 101.5 | 201.9 |
| objects / root | bytes / 1,024 | 167.3 | 67.0 | 98.7 | 189.0 |
| unicode / root | bytes / 65,536 | 1308.4 | 65.5 | 840.3 | 591.9 |
| objects / root | bytes / 65,536 | 174.7 | 69.3 | 108.8 | 229.9 |
| objects / items | bytes / 1,024 | 156.2 | 61.0 | 57.1 | 154.2 |
| ascii / string | bytes / 1,024 | 1851.4 | 1286.7 | 716.0 | unsupported |
| unicode / string | bytes / 1,024 | 786.3 | 65.5 | 599.6 | unsupported |
| escapes / string | bytes / 1,024 | 372.4 | 40.0 | 80.1 | unsupported |
| objects / items | bytes / 65,536 | 160.9 | 61.5 | 61.3 | 184.6 |
| ascii / string | bytes / 65,536 | 5207.1 | 1632.8 | 806.6 | unsupported |
| unicode / string | bytes / 65,536 | 1304.9 | 67.4 | 927.7 | unsupported |
| escapes / string | bytes / 65,536 | 604.1 | 38.7 | 74.0 | unsupported |
| llm / string | text / 16 | 172.5 | 35.3 | 106.1 | unsupported |
| llm / string | bytes / 16 | 47.6 | 44.6 | 36.5 | unsupported |
| llm / string | text / 128 | 216.7 | 65.3 | 112.2 | unsupported |
| llm / string | bytes / 128 | 135.8 | 69.2 | 83.9 | unsupported |

### bun

`1.4.2`; 38 scenarios, 456 workers: 426 valid, 30 unsupported, 0 failed.

| Workload | Input / chunk | Ours | @streamparser/json | stream-json | json-web-streams |
|---|---|---:|---:|---:|---:|
| ascii / root | text / 1,024 | 5365.9 | 1232.5 | 1415.9 | 898.2 |
| ascii / root | bytes / 1,024 | 5001.2 | 1498.8 | 954.4 | 708.0 |
| unicode / root | text / 1,024 | 2615.4 | 117.4 | 2060.0 | 1476.2 |
| unicode / root | bytes / 1,024 | 424.7 | 137.4 | 370.2 | 632.8 |
| escapes / root | text / 1,024 | 277.9 | 48.6 | 37.3 | 450.0 |
| escapes / root | bytes / 1,024 | 277.1 | 47.7 | 39.4 | 391.1 |
| numbers / root | text / 1,024 | 302.6 | 80.4 | 113.5 | 346.4 |
| numbers / root | bytes / 1,024 | 291.0 | 80.5 | 117.0 | 309.0 |
| decimals / root | text / 1,024 | 257.0 | 109.8 | 211.1 | 327.4 |
| decimals / root | bytes / 1,024 | 247.6 | 113.7 | 204.5 | 299.0 |
| literals / root | text / 1,024 | 260.4 | 190.9 | 102.0 | 374.4 |
| literals / root | bytes / 1,024 | 257.9 | 195.6 | 102.3 | 325.6 |
| short strings / root | text / 1,024 | 257.4 | 132.4 | 383.3 | 243.4 |
| short strings / root | bytes / 1,024 | 265.7 | 132.8 | 360.1 | 226.6 |
| wide / root | text / 1,024 | 133.0 | 71.8 | 124.3 | 223.9 |
| wide / root | bytes / 1,024 | 131.9 | 74.0 | 124.1 | 206.2 |
| empty / root | text / 1,024 | 65.6 | 68.4 | 76.9 | 147.5 |
| empty / root | bytes / 1,024 | 67.0 | 69.2 | 71.2 | 138.6 |
| nested / root | text / 1,024 | 38.6 | 45.4 | 38.6 | 80.4 |
| nested / root | bytes / 1,024 | 38.6 | 47.1 | 39.7 | 73.4 |
| tiny / root | text / 1,024 | 25.0 | 19.1 | 24.2 | 9.9 |
| tiny / root | bytes / 1,024 | 26.5 | 19.3 | 22.7 | 8.5 |
| objects / root | text / 1,024 | 189.1 | 64.9 | 110.3 | 345.2 |
| objects / root | bytes / 1,024 | 179.1 | 65.7 | 106.9 | 278.6 |
| unicode / root | bytes / 65,536 | 625.4 | 128.8 | 517.1 | 1105.8 |
| objects / root | bytes / 65,536 | 186.2 | 67.0 | 120.9 | 350.0 |
| objects / items | bytes / 1,024 | 152.8 | 70.4 | 69.8 | 220.4 |
| ascii / string | bytes / 1,024 | 3113.3 | 1414.7 | 1222.7 | unsupported |
| unicode / string | bytes / 1,024 | 392.6 | 134.2 | 375.4 | unsupported |
| escapes / string | bytes / 1,024 | 270.4 | 50.7 | 78.7 | unsupported |
| objects / items | bytes / 65,536 | 187.5 | 72.7 | 74.8 | 273.6 |
| ascii / string | bytes / 65,536 | 10643.3 | 1762.7 | 1370.7 | unsupported |
| unicode / string | bytes / 65,536 | 616.5 | 144.3 | 512.4 | unsupported |
| escapes / string | bytes / 65,536 | 303.6 | 49.6 | 60.8 | unsupported |
| llm / string | text / 16 | 211.0 | 61.6 | 102.5 | unsupported |
| llm / string | bytes / 16 | 100.4 | 65.8 | 63.4 | unsupported |
| llm / string | text / 128 | 298.9 | 108.6 | 122.9 | unsupported |
| llm / string | bytes / 128 | 210.0 | 113.8 | 105.6 | unsupported |

### deno (secondary subset)

`deno 2.9.7 (stable, release, aarch64-apple-darwin)`; 6 scenarios, 72 workers: 66 valid, 6 unsupported, 0 failed.

| Workload | Input / chunk | Ours | @streamparser/json | stream-json | json-web-streams |
|---|---|---:|---:|---:|---:|
| numbers / root | bytes / 1,024 | 242.9 | 58.9 | 100.0 | 306.2 |
| objects / root | bytes / 1,024 | 168.7 | 65.2 | 104.5 | 204.3 |
| unicode / root | bytes / 1,024 | 727.9 | 39.9 | 569.5 | 380.8 |
| objects / items | bytes / 65,536 | 162.2 | 57.6 | 63.9 | 188.0 |
| llm / string | text / 128 | 229.6 | 48.7 | 128.0 | unsupported |
| llm / string | bytes / 128 | 163.7 | 52.6 | 104.4 | unsupported |

## Why workloads differ

The source explains architectural differences; it does not establish how many
percent each mechanism contributes without a profile or isolated experiment.

- **json-web-streams complete values:** its installed `dist/JSONParseStreamRaw.js`
  scans a selected object's/array's boundary, joins captured pieces and calls
  `JSON.parse` in `endCapture`. Native construction can explain an advantage on
  numeric arrays and mixed objects. It buffers the selected value until completion
  and does not offer our decoded-fragment contract. This is an inference from
  implementation and workload results, not an isolated measurement of JSON.parse.
- **stream-json:** public core methods produce token records and a separate
  assembler builds values. Its complete-string fast path scans and decodes inline
  in the value branch; the general parser handles chunk continuations. The assembler
  converts number tokens with parseFloat. Bun short-string roots are a concrete
  follow-up: compare whole-string completion costs and JIT behavior rather than
  attributing the result to token allocation alone.
- **@streamparser/json:** the tokenizer operates on bytes and encodes text input.
  It uses per-token callbacks and Number on completed numeric text, with optional
  string/number buffer settings. This comparison uses defaults. Its Unicode
  decoding and cumulative partial previews are different costs from our text
  scanner and independent string fragments. Buffer tuning is a separate experiment.
- **Our parser:** JSON and JSON5 frontends are separate; selectors drive retention,
  keys have a bounded reuse cache, and strings use native scanning plus decoded
  fragment callbacks. Complete roots still pay JS container/property construction,
  strict validation and subscription setup. These tables do not measure JSON5 or
  asynchronous downstream consumer work.

Backpressure policies cannot be compared as a single speed number: push cores
finish each write synchronously, while Web pipelines schedule queued work. Stream
scheduling is included where the public API requires it. See the capability matrix
for which layer paces input and which APIs await downstream work.

## Correctness probes

The separate check run feeds one UTF-16 unit or UTF-8 byte at a time for escaped
surrogate pairs, escaped slash and a raw Unicode boundary. Full root values and
joined fragments/previews are compared to the fixture. These probes complement,
but do not replace, each package's conformance tests. Boundary-check results are included in the archived raw files.

| Runtime | Passed | Unsupported | Failed |
|---|---:|---:|---:|
| node | 42 | 6 | 0 |
| bun | 42 | 6 | 0 |
| deno | 42 | 6 | 0 |

A passing probe is not a complete JSON conformance claim. These one-unit inputs are correctness tests, not performance
priorities for LLM streams.

## Reproduction and raw data

`npm run benchmark:competitors` builds, checks and compares Node and Bun, then
regenerates this report. `npm run benchmark:competitors:deno` adds the secondary
Deno subset after the primary run (Deno must already be installed). Runtime versions and CPU information
are stored in every result file. Fresh workers run serially; do not run several
benchmark commands concurrently or rebuild while a benchmark is active.

Raw worker samples for this run are checked in under
[benchmarks/v3-comparison-data](../benchmarks/v3-comparison-data). Normal reruns write
to ignored `benchmarks/results`. The report generator reads those outputs; archived
2.x release reports are preserved. Per-case follow-up tasks are kept under ignored
`notes/todo/performance/package-comparison-2026-10-08.md`.

Implementation references:

- [json-web-streams source](https://github.com/zengm-games/json-web-streams): JSONParseStreamRaw capture and native value construction.
- [stream-json source](https://github.com/uhop/stream-json): core parser, assembler, pick and streamArray.
- [@streamparser/json source](https://github.com/juanjoDiaz/streamparser-json/tree/main/packages/json): tokenizer, partial options and buffers.

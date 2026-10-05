# LLM string streaming baseline

Baseline: PR18 (`ba97d14e0636078c0997ecf2c765bdab5fc0b3d7`). This follow-up changes benchmark/test coverage only; parser source is unchanged.

Primary LLM workload: a JSON object with metadata followed by a long `text` field containing Ukrainian text, emoji, newlines, quoted code and backslashes. `onString(['text'])` receives decoded fragments with `retainRoot: false`. The escape-heavy fixture is a separate stress case. Fixture definitions live in `scripts/v3/benchmark-worker.mjs`.

Protocol: UTF-8 byte input, 32/128/1024-byte chunks, three serial fresh processes per case, 160 warmups and seven samples of 32 parses. The table gives median throughput across those processes, in decimal MB/s of encoded JSON input. Construction, registration and consumed concrete callback paths are included; reconstructed text is checked. These are local throughput measurements, not network or model latency measurements.

| workload | chunk | Node 26 MB/s | Bun MB/s | Deno MB/s |
| --- | ---: | ---: | ---: | ---: |
| llm / onString | 32 | 80.5 | 167.0 | 102.1 |
| llm / onString | 128 | 166.5 | 274.4 | 199.1 |
| llm / onString | 1024 | 255.9 | 348.0 | 315.3 |
| escapes / onString | 32 | 59.4 | 121.0 | 77.0 |
| escapes / onString | 128 | 93.3 | 164.5 | 112.6 |
| escapes / onString | 1024 | 137.8 | 190.1 | 152.6 |

Runtimes: Node 26.10.0, Bun 1.4.2, Deno 2.9.7 (V8 15.0.245.2-rusty).

## Delivery contract

Callbacks run synchronously inside `write()`. Tests check that the first fragment arrives in the earliest write that contains the first complete UTF-8 character, with byte chunks of 1, 2, 3, 7, 32, 128 and 1024 bytes, for both JSON and JSON5. Text-input tests check immediate delivery before the closing quote and preserve a surrogate pair split between writes. An incomplete code point or trailing high surrogate can wait for its continuation; the parser adds no whole-string batching.

This verifies delivery timing by write index, rather than claiming nanosecond latency improvements from noisy timings. Fragments are provisional: a later malformed JSON token reports an error after earlier fragments have been delivered.

## Reproduce

```sh
npm run build
node scripts/v3/benchmark.mjs --engine node --format json --pairs 3 --warmups 160 --iterations 32 --sizes 32,128,1024 --cases 'llm/string,escapes/string'
node scripts/v3/benchmark.mjs --engine bun --format json --pairs 3 --warmups 160 --iterations 32 --sizes 32,128,1024 --cases 'llm/string,escapes/string'
node scripts/v3/benchmark.mjs --engine deno --format json --pairs 3 --warmups 160 --iterations 32 --sizes 32,128,1024 --cases 'llm/string,escapes/string'
```

For already-decoded LLM text chunks, repeat with `--input text`; byte-input throughput does not represent that mode. JSON5 is tested for delivery correctness here; the throughput table uses strict JSON. Do not infer the same timing for JSON5, Web/Node adapters, async consumption or full-value retention.

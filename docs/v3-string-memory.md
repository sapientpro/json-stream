# String memory audit

Compared with main `bea49af` (merged PR32–33), Apple M4 Pro, Node 26.10.0 and Bun 1.4.2. The first fix releases the strict JSON scanner's last RegExp subject at document end, reset, cancellation and syntax error. It does not change string delivery or copying policy.

## Completed-input retention

Each fresh diagnostic process holds four parsers after parsing four documents, each with an ignored 8 MiB ASCII string and a small Unicode value. No values or fragments are requested in this comparison. Input and allocation stack frames are released before three explicit collections, separated by event-loop turns. The parsers remain reachable.

| Runtime/input | main | patch |
| --- | --- | --- |
| Node/text, heap | 16.09 MiB | 0.09 MiB |
| Node/bytes, external memory | 8.00 MiB | <0.001 MiB |
| Bun/text, heap | 16.13 MiB | 0.13 MiB |
| Bun/bytes, heap | 16.13 MiB | 0.13 MiB |

These are `end()` results; `reset()`, `destroy()` and syntax errors reproduce the same improvement. Node byte input stores this retained string outside the reported JS heap, so heap-only measurements would miss it. Bun's heap and external counters can overlap and must not be added together. The larger text representation reflects the Unicode-containing input; 32 MiB of ignored ASCII payload is not the same as its decoded storage size.

This is a retained-memory diagnostic, not a peak measurement. Sampled high counters miss transient allocations between samples. RSS also includes allocator/runtime reservations and does not fall immediately when strings become unreachable. Forced collection is confined to the diagnostic script; neither the parser nor the natural-GC throughput protocol invokes it.

```sh
node --expose-gc scripts/verify-string-memory.mjs json text none end
bun scripts/verify-string-memory.mjs json bytes none end
```

Positional arguments: format (`json`/`json5`), input (`text`/`bytes`), output (`none`/`root`/`selective`/`fragments`/`dense`), lifecycle (`end`/`reset`/`destroy`/`error`), optional separately built ESM entry. Root and selective/fragment outputs are validated before measurement. A second measurement drops saved outputs while retaining parsers, separating consumer retention from scanner retention.

## Throughput controls

Serial fresh-process alternating pairs, three pairs per case, seven timed samples, natural GC, identical canonical module paths. Construction, registration, writes, end and result consumption are timed. Large-chunk cases use 256 warmups and 64 documents per sample; LLM/128 uses 512 and 128. Tiny documents use 8192 and 32768 because the shorter preliminary run was too noisy. Wall throughput is primary; process CPU samples are also recorded. Units are decimal MB/s.

| Case, text input | Node main → patch | Bun main → patch |
| --- | --- | --- |
| objects/root, 65536 units | 183.9 → 181.0 (−1.6%) | 268.0 → 263.6 (−1.6%) |
| objects/ids, 65536 units | 167.9 → 168.7 (+0.5%) | 237.4 → 254.5 (+7.2%) |
| short strings/root, 65536 units | 214.4 → 211.6 (−1.3%) | 376.0 → 360.6 (−4.1%) |
| LLM/string, 65536 units | 855.7 → 837.9 (−2.1%) | 425.9 → 422.6 (−0.8%) |
| LLM/string, 128 units | 292.4 → 292.9 (+0.2%) | 480.1 → 495.7 (+3.2%) |
| small/root, 128 units | 58.0 → 56.6 (−2.3%) | 94.7 → 92.3 (−2.5%) |
| scalar/root, 128 units | 6.0 → 5.9 (−1.4%) | 9.1 → 9.9 (+9.2%) |

Ratios use the median throughput of each version; pair ranges are a separate statistic. Most controls cross zero: Node LLM/128 −3.0…+3.1%, Bun −1.4…+3.7%; Node objects/root −3.4…+0.7%, Bun −2.0…+1.7%. The longer Bun small/root run is negative in all pairs (−6.5…−2.5%), and Node scalar/root is −4.5…−0.9%. End cleanup has a small per-document cost; this is a memory fix, not a universal throughput improvement.

## Remaining output retention

The broader baseline audit requests full roots, individual values, independent string fragments or a 2 MiB selected string, with text and bytes on both formats. It identifies a separate copying problem:

- Holding four tiny Unicode fragments from large text documents retains about 64 MiB on both runtimes. Dropping the fragments releases those buffers, apart from the strict scanner's last subject fixed here.
- Bun also retains about 64 MiB when keeping four tiny selected values, in both formats and both input modes. The current concat/slice flattening expression does not reliably detach them on Bun.
- Additional short-string probes find that Bun can retain a source even for 4, 11 and 12 code units: four saved values or fragments retain about 32 MiB with ASCII input. The V8-oriented `<13` shortcut is therefore not a portable detachment rule.
- Four selected 2 MiB strings retain about 40 MiB on Bun, rather than just their 8 MiB ASCII output payload. Full roots intentionally retain the ignored strings too.
- Node byte strings may live in external memory; low heap use does not prove that output slices are independent.

These findings require a separate sparse-output copying experiment with LLM and dense-output controls. This patch does not resolve them. Short-key cache retention, output path lifetimes, true transient peak measurements and wrapper queues remain further audit work.

Two isolated copying prototypes were rejected. Native stringify/parse detachment with a simple 1024-unit size-gap guard reduced retained memory but slowed Node LLM/65536 from 867.8 to 316.0 MB/s (−63.6%): decoding escapes itself creates that size gap. Requiring output below a quarter of the input restored this large-chunk control, but Node LLM/128 was −1.5% (all three pairs negative), Bun objects/root/65536 was −3.0% (all pairs negative), and the short-string shortcut still leaked on Bun. Neither prototype is part of this patch. The next experiment must cover short strings and key/path caches and avoid adding copying checks to ordinary small-fragment delivery.

Validation: 447 tests in 25 suites; 22400 differential format checks on each of Node and Bun. Lifecycle tests exercise nested parser completion, reset, cancellation and failure during another parser's callbacks, including Unicode byte input.

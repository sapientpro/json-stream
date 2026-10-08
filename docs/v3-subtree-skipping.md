# Validation-only subtree skipping — draft experiment

This draft changes the strict JSON implementation without adding public options
or changing callbacks, value retention, decoded string streaming or transports.
It is not part of the alpha.2 release and is **not ready to merge**.

## Decision and execution

The existing cached selector context identifies consumers and possible descendant
matches. The existing container slot identifies whether an ancestor needs the
complete value. At container entry, the parser chooses a validation-only path
only when there is no matched context and no value to collect for an ancestor.
The decision applies to the whole subtree; it is not recomputed for every child.

Conceptually these decisions are independent: dispatch a value, stream a string,
visit matching descendants, and collect a value. An unmatched descendant of a
selected container must still be collected. No new public context API or enum is
introduced; the experiment specializes the existing empty-context case.

`JsonSubtreeValidator` uses a compact grammar stack. It checks strings, escapes,
numbers, literals, separators and depth without decoding keys, producing values,
building paths or invoking per-value dispatch. UTF decoding remains in the input
layer. The main stack and its concrete path resume after the ignored subtree.
For a subtree spanning writes, the parser temporarily selects the validation
runner and restores the ordinary runner at completion. Ordinary writes have no
per-write wrapper. Skipped containers do not use `JSON.parse`.

JSON5 continues through the existing general implementation; no JSON5 skip
lexer is introduced. Existing selector caches also retain their cancellation
behavior: this does not implement subtree active-consumer counts or reclaim an
already-built ancestor container after its consumer cancels.

## Verdict and limitations

Whole-branch skipping is promising. Across the final strict JSON medians,
discarded metadata improved by **52–112%**, and objects with no matching selectors
improved substantially too. The bounded short-string prefix in the validator is
important: using a regexp even for every tiny key/value made small subtrees more
expensive in the preceding prototype.

This is not a general speedup. Node LLM input at 128 units/write regressed about
**2.6% in both text and bytes**, with all paired wall-time and CPU changes negative.
Other small-output controls also regress. Bun escape-heavy 65536-unit text runs
show large variation: the ratio of worker medians is **−42.5%**, while the three
paired changes are −53.4%, +5.0%, +17.2%. Their CPU changes also vary strongly.
The cause is not established and those samples are neither removed nor treated
as proof of one particular JIT/GC mechanism. These costs and instability keep the
PR in draft. Avoid promoting only the target-workload gains.

## Validation

- 461 tests, including ignored malformed syntax, every cut, one-unit writes,
  depth, ancestor collection, persistent/canceled callbacks, fragments, reset,
  raw input collection, error/destroy and JSONL/prefix managers.
- 18,635 dedicated checks each on Node, Bun and Deno; 6,000 mutated payloads use
  `JSON.parse` as an independent test oracle. Instrumentation confirms the skip
  runner is exercised. Depth and selector behavior also compare with a retained
  root, which forces the general builder.
- 22,400 JSON/JSON5 differential checks each on Node and Bun.
- 32 fresh retained-memory probes: both implementations, text/bytes, Node/Bun,
  end/reset/error/destroy. Four large inputs are released while parser objects
  remain alive. Additional retained heap stayed below 0.2 MiB and external memory
  below 0.14 MiB. These forced-GC diagnostics are not peak or RSS measurements;
  the runtime parser contains no GC calls.

## Measurements

Baseline alpha.2, commit `0d58acb`; Node 26.11.0 and Bun 1.4.2.
**552 serial timing workers / 92 combinations**: 80 strict JSON combinations and
12 JSON5 controls. Three rotating fresh-process pairs; 128 warmups; seven samples
of 24 parses; natural GC. Both versions use the same staged module path. Parser
setup, callbacks and owned concrete path consumption are included. Each worker
checks output. Throughput counts UTF-8 document bytes for both input forms.
Text chunk sizes are UTF-16 units; byte input chunk sizes are bytes.

Throughput columns are medians of three worker medians. Paired columns preserve
all three comparisons. CPU changes use median process CPU time per parse; that
includes runtime background work and is not a CPU profile or isolated JS time.
JSON5 rows describe controls, not a new skip implementation.

[Full raw timing samples, source hashes and memory probes](../benchmarks/v3-subtree-skip-data/measurements.json).

| Engine/format/input | Case | Units/write | alpha.2 MB/s | Experiment MB/s | Change | All paired changes | CPU paired changes |
|---|---|---:|---:|---:|---:|---|---|
| node/json/text | short strings/scalar | 128 | 163.0 | 158.6 | -2.7% | -3.1%, -3.5%, -2.7% | -2.1%, -1.9%, -2.7% |
| node/json/text | objects/root | 128 | 138.3 | 136.8 | -1.1% | +2.2%, -1.1%, -1.2% | +4.1%, -2.8%, +0.5% |
| node/json/text | objects/ids | 128 | 139.9 | 144.4 | +3.2% | +3.2%, +1.4%, +8.9% | +3.2%, +1.4%, +8.8% |
| node/json/text | objects/items | 128 | 126.0 | 126.0 | -0.0% | -1.1%, -2.0%, +2.8% | -0.8%, -2.0%, +3.2% |
| node/json/text | objects/overlap | 128 | 95.0 | 97.4 | +2.5% | +3.0%, +0.8%, +2.5% | +1.7%, +0.2%, +2.6% |
| node/json/text | objects/missing | 128 | 187.9 | 335.3 | +78.5% | +75.4%, +78.5%, +82.1% | +74.9%, +76.7%, +81.7% |
| node/json/text | discarded metadata/ids | 128 | 155.8 | 256.0 | +64.4% | +60.0%, +73.6%, +64.6% | +59.1%, +73.3%, +65.4% |
| node/json/text | integers/cancel | 128 | 174.6 | 175.1 | +0.3% | -1.7%, -3.7%, +6.5% | -2.9%, -3.5%, +6.3% |
| node/json/text | escapes/string | 128 | 139.7 | 139.0 | -0.5% | -0.9%, +1.0%, +0.6% | +0.3%, -0.5%, +2.9% |
| node/json/text | llm/string | 128 | 288.4 | 280.8 | -2.6% | -2.1%, -1.1%, -2.6% | -2.4%, -0.8%, -1.9% |
| node/json/text | short strings/scalar | 65536 | 160.1 | 160.2 | +0.0% | -1.0%, -1.0%, +0.0% | -1.8%, -1.2%, -0.3% |
| node/json/text | objects/root | 65536 | 177.8 | 182.8 | +2.9% | -0.4%, -1.3%, +4.1% | -0.1%, -1.3%, +3.7% |
| node/json/text | objects/ids | 65536 | 167.3 | 174.2 | +4.1% | +2.6%, +3.9%, +5.7% | +2.6%, +3.4%, +5.4% |
| node/json/text | objects/items | 65536 | 153.3 | 152.5 | -0.5% | +0.7%, +17.2%, -1.5% | +0.6%, +17.2%, -1.7% |
| node/json/text | objects/overlap | 65536 | 109.2 | 108.0 | -1.1% | -2.6%, +1.0%, -0.4% | -2.2%, +3.4%, +0.5% |
| node/json/text | objects/missing | 65536 | 197.9 | 338.7 | +71.2% | +67.8%, +78.3%, +70.8% | +67.4%, +78.1%, +70.2% |
| node/json/text | discarded metadata/ids | 65536 | 152.2 | 271.6 | +78.4% | +77.7%, +81.7%, +81.4% | +77.3%, +81.6%, +81.5% |
| node/json/text | integers/cancel | 65536 | 166.8 | 166.7 | -0.0% | +0.4%, +0.2%, -0.0% | -0.4%, +1.1%, +0.4% |
| node/json/text | escapes/string | 65536 | 494.9 | 493.0 | -0.4% | -4.5%, -1.1%, +0.7% | -4.1%, -0.0%, -0.8% |
| node/json/text | llm/string | 65536 | 842.2 | 815.2 | -3.2% | -0.8%, +1.1%, -4.0% | -3.9%, +1.1%, -3.3% |
| bun/json/text | short strings/scalar | 128 | 211.8 | 199.3 | -5.9% | -3.1%, -7.0%, -0.5% | +3.6%, -6.5%, -1.3% |
| bun/json/text | objects/root | 128 | 197.3 | 192.5 | -2.4% | +9.7%, -2.4%, -3.3% | +3.5%, -4.0%, -5.2% |
| bun/json/text | objects/ids | 128 | 189.6 | 187.8 | -0.9% | +10.4%, -1.1%, +3.3% | +10.3%, -2.7%, +5.0% |
| bun/json/text | objects/items | 128 | 170.1 | 173.3 | +1.9% | -0.4%, +16.4%, +1.2% | -0.0%, +15.4%, +2.2% |
| bun/json/text | objects/overlap | 128 | 125.4 | 123.1 | -1.8% | -1.5%, -1.8%, -3.3% | -2.7%, -0.0%, -5.2% |
| bun/json/text | objects/missing | 128 | 319.0 | 666.2 | +108.8% | +108.8%, +105.9%, +104.2% | +119.7%, +118.2%, +112.3% |
| bun/json/text | discarded metadata/ids | 128 | 282.5 | 459.5 | +62.6% | +64.0%, +54.0%, +76.9% | +69.7%, +61.0%, +79.0% |
| bun/json/text | integers/cancel | 128 | 274.2 | 271.1 | -1.1% | -1.4%, +1.9%, -1.6% | -1.8%, +1.7%, -2.2% |
| bun/json/text | escapes/string | 128 | 219.4 | 224.8 | +2.4% | +4.0%, +1.8%, -0.1% | +6.1%, -0.2%, -1.9% |
| bun/json/text | llm/string | 128 | 465.3 | 466.6 | +0.3% | +1.4%, -2.0%, -0.9% | +6.4%, -3.6%, -1.9% |
| bun/json/text | short strings/scalar | 65536 | 217.2 | 219.6 | +1.1% | +0.4%, +1.9%, +1.1% | +1.0%, +0.5%, +0.8% |
| bun/json/text | objects/root | 65536 | 266.0 | 267.5 | +0.6% | -0.6%, +0.6%, -1.2% | +0.9%, +0.4%, -1.7% |
| bun/json/text | objects/ids | 65536 | 229.7 | 246.7 | +7.4% | +5.3%, +4.4%, +13.0% | +7.1%, +4.1%, +11.8% |
| bun/json/text | objects/items | 65536 | 213.9 | 215.5 | +0.8% | -5.5%, +0.8%, +3.5% | -4.2%, +1.5%, +4.3% |
| bun/json/text | objects/overlap | 65536 | 150.3 | 150.5 | +0.1% | +1.4%, -3.2%, -0.6% | +3.2%, +0.6%, -2.5% |
| bun/json/text | objects/missing | 65536 | 352.6 | 689.1 | +95.4% | +93.0%, +101.2%, +98.6% | +102.0%, +109.2%, +111.7% |
| bun/json/text | discarded metadata/ids | 65536 | 230.2 | 487.6 | +111.8% | +111.8%, +110.9%, +107.1% | +115.7%, +114.7%, +110.5% |
| bun/json/text | integers/cancel | 65536 | 312.8 | 310.8 | -0.6% | +1.4%, +5.2%, -3.0% | +1.8%, +6.1%, -1.4% |
| bun/json/text | escapes/string | 65536 | 223.4 | 128.6 | -42.5% | -53.4%, +5.0%, +17.2% | -82.1%, +7.1%, +68.1% |
| bun/json/text | llm/string | 65536 | 417.1 | 401.4 | -3.8% | -3.5%, -0.1%, -15.1% | +3.7%, -2.3%, -29.6% |
| node/json/bytes | objects/ids | 128 | 146.1 | 144.6 | -1.1% | +2.1%, -1.8%, -1.5% | +2.2%, -2.3%, -1.7% |
| node/json/bytes | objects/items | 128 | 133.6 | 131.3 | -1.7% | -0.5%, -1.3%, -2.1% | -0.5%, -1.4%, -2.1% |
| node/json/bytes | objects/missing | 128 | 193.1 | 323.9 | +67.8% | +62.9%, +68.3%, +66.8% | +62.4%, +68.9%, +71.6% |
| node/json/bytes | discarded metadata/ids | 128 | 163.1 | 255.1 | +56.3% | +53.4%, +59.9%, +55.4% | +53.5%, +60.0%, +55.0% |
| node/json/bytes | escapes/string | 128 | 106.2 | 104.9 | -1.2% | -1.4%, +1.2%, -0.9% | -1.2%, +1.2%, -1.1% |
| node/json/bytes | llm/string | 128 | 189.4 | 184.6 | -2.6% | -1.5%, -2.5%, -2.6% | -1.4%, -1.9%, -2.2% |
| node/json/bytes | objects/ids | 65536 | 197.0 | 199.5 | +1.3% | -0.4%, +1.2%, +1.8% | -0.4%, +1.3%, +2.0% |
| node/json/bytes | objects/items | 65536 | 171.9 | 174.3 | +1.3% | +4.1%, +2.6%, -2.5% | +3.5%, +2.4%, -2.3% |
| node/json/bytes | objects/missing | 65536 | 237.1 | 421.8 | +77.9% | +82.6%, +82.9%, +75.5% | +80.6%, +83.3%, +71.6% |
| node/json/bytes | discarded metadata/ids | 65536 | 183.6 | 326.3 | +77.7% | +76.3%, +79.8%, +77.7% | +75.2%, +80.0%, +77.2% |
| node/json/bytes | escapes/string | 65536 | 394.4 | 390.3 | -1.0% | -1.7%, -0.3%, +0.5% | -2.3%, -2.0%, -0.2% |
| node/json/bytes | llm/string | 65536 | 635.5 | 638.0 | +0.4% | +0.5%, +0.2%, -1.1% | -1.0%, +1.5%, -2.3% |
| bun/json/bytes | objects/ids | 128 | 174.3 | 195.6 | +12.2% | +13.8%, +12.2%, -1.6% | +13.6%, +10.8%, -1.5% |
| bun/json/bytes | objects/items | 128 | 164.7 | 162.5 | -1.3% | -0.1%, -3.5%, -0.6% | +0.6%, -4.5%, -0.0% |
| bun/json/bytes | objects/missing | 128 | 282.2 | 542.2 | +92.2% | +86.0%, +90.2%, +94.5% | +93.7%, +98.3%, +101.2% |
| bun/json/bytes | discarded metadata/ids | 128 | 256.3 | 390.4 | +52.3% | +50.0%, +52.3%, +52.1% | +55.5%, +56.8%, +55.7% |
| bun/json/bytes | escapes/string | 128 | 169.3 | 171.0 | +1.0% | +0.9%, +0.7%, +1.0% | -1.3%, +1.5%, +2.7% |
| bun/json/bytes | llm/string | 128 | 290.3 | 280.5 | -3.4% | -0.5%, -3.4%, +0.9% | +0.6%, -3.2%, +0.8% |
| bun/json/bytes | objects/ids | 65536 | 260.9 | 244.1 | -6.4% | +4.9%, -4.1%, -10.8% | +5.7%, -2.8%, -9.9% |
| bun/json/bytes | objects/items | 65536 | 226.2 | 221.6 | -2.1% | +4.5%, -13.5%, -2.6% | +9.2%, -15.2%, -2.9% |
| bun/json/bytes | objects/missing | 65536 | 361.7 | 670.8 | +85.4% | +82.4%, +83.7%, +90.4% | +90.2%, +86.2%, +99.0% |
| bun/json/bytes | discarded metadata/ids | 65536 | 243.6 | 481.3 | +97.6% | +114.1%, +97.6%, +97.0% | +113.3%, +94.0%, +98.2% |
| bun/json/bytes | escapes/string | 65536 | 143.4 | 157.2 | +9.6% | +53.2%, -13.8%, +9.6% | +180.8%, -16.4%, +16.5% |
| bun/json/bytes | llm/string | 65536 | 389.2 | 389.8 | +0.1% | +1.8%, +0.4%, -9.9% | +9.2%, +7.5%, -21.8% |
| node/json/bytes | short strings/scalar | 128 | 165.2 | 163.1 | -1.2% | -0.7%, -2.8%, -1.7% | -1.5%, -1.9%, -1.4% |
| node/json/bytes | objects/root | 128 | 138.2 | 140.8 | +1.9% | +0.0%, +1.9%, -0.4% | +1.0%, +0.9%, -0.7% |
| node/json/bytes | objects/overlap | 128 | 96.8 | 96.3 | -0.5% | -0.5%, +1.1%, -0.5% | -1.4%, -0.1%, -0.6% |
| node/json/bytes | integers/cancel | 128 | 187.5 | 187.2 | -0.2% | -0.2%, +0.9%, +1.9% | +1.7%, -2.0%, +2.0% |
| node/json/bytes | short strings/scalar | 65536 | 184.9 | 184.9 | -0.0% | +1.6%, +4.3%, -0.2% | +2.6%, +4.3%, +0.8% |
| node/json/bytes | objects/root | 65536 | 184.8 | 187.4 | +1.4% | +0.0%, +3.0%, +0.3% | +4.3%, +2.8%, +0.7% |
| node/json/bytes | objects/overlap | 65536 | 118.9 | 117.8 | -0.9% | -2.0%, +2.4%, -1.5% | -3.6%, +3.1%, -2.4% |
| node/json/bytes | integers/cancel | 65536 | 209.1 | 214.5 | +2.6% | -3.6%, -5.2%, +9.0% | -3.6%, -6.4%, +9.4% |
| bun/json/bytes | short strings/scalar | 128 | 181.6 | 194.9 | +7.3% | +16.0%, -2.4%, +7.3% | +12.2%, -1.5%, +6.0% |
| bun/json/bytes | objects/root | 128 | 181.3 | 181.5 | +0.1% | +1.5%, +1.5%, -1.6% | +3.2%, +0.5%, -1.6% |
| bun/json/bytes | objects/overlap | 128 | 115.7 | 115.8 | +0.1% | -1.5%, +0.3%, +3.0% | -1.4%, +1.1%, +6.8% |
| bun/json/bytes | integers/cancel | 128 | 241.4 | 242.3 | +0.4% | +2.7%, -0.1%, -0.6% | +2.7%, -0.5%, -0.7% |
| bun/json/bytes | short strings/scalar | 65536 | 208.0 | 207.4 | -0.3% | +3.3%, -8.4%, -2.0% | +3.0%, -8.3%, -1.7% |
| bun/json/bytes | objects/root | 65536 | 266.8 | 268.8 | +0.7% | +1.2%, -8.5%, +1.5% | +1.4%, -10.9%, +1.3% |
| bun/json/bytes | objects/overlap | 65536 | 153.8 | 155.4 | +1.0% | +2.8%, -0.7%, +0.7% | +4.1%, -0.8%, +0.5% |
| bun/json/bytes | integers/cancel | 65536 | 306.2 | 299.2 | -2.3% | -2.8%, +0.7%, -2.7% | -4.2%, -1.7%, -5.3% |
| node/json5/text | objects/root | 128 | 134.7 | 134.0 | -0.5% | -1.7%, -0.4%, -0.5% | -4.3%, +0.5%, -1.3% |
| node/json5/text | discarded metadata/ids | 128 | 164.9 | 163.3 | -1.0% | -2.0%, -3.2%, +0.0% | -2.2%, -3.2%, +0.2% |
| node/json5/text | llm/string | 128 | 301.0 | 303.2 | +0.7% | +2.1%, -0.8%, +0.7% | +1.6%, -0.4%, +1.2% |
| node/json5/text | objects/root | 65536 | 144.0 | 142.4 | -1.1% | +1.4%, -2.0%, -0.8% | +0.4%, -2.9%, -1.4% |
| node/json5/text | discarded metadata/ids | 65536 | 170.4 | 169.5 | -0.6% | -3.2%, +0.8%, +2.4% | -3.2%, +1.3%, +1.7% |
| node/json5/text | llm/string | 65536 | 357.7 | 356.8 | -0.3% | -4.1%, +3.0%, -0.3% | -3.5%, +2.6%, -0.7% |
| bun/json5/text | objects/root | 128 | 128.0 | 127.5 | -0.4% | -0.4%, +5.9%, -3.6% | +3.6%, +4.1%, +2.1% |
| bun/json5/text | discarded metadata/ids | 128 | 197.4 | 195.5 | -1.0% | +0.1%, -1.1%, +0.1% | +0.3%, -0.7%, +0.5% |
| bun/json5/text | llm/string | 128 | 411.3 | 417.5 | +1.5% | +3.3%, +0.0%, -5.3% | +4.8%, -0.7%, -6.3% |
| bun/json5/text | objects/root | 65536 | 139.4 | 137.6 | -1.3% | -0.4%, -2.8%, +0.5% | -1.3%, -3.9%, +3.3% |
| bun/json5/text | discarded metadata/ids | 65536 | 201.8 | 206.4 | +2.3% | +0.0%, +5.1%, +2.3% | -0.2%, +4.1%, +2.6% |
| bun/json5/text | llm/string | 65536 | 360.0 | 355.3 | -1.3% | -1.3%, -4.6%, +49.6% | -1.6%, -6.3%, +129.9% |

## Reproduce

Build alpha.2 in a separate checkout to provide the baseline module below.

```sh
npm run build
npm test -- --runInBand
node scripts/v3/verify-subtrees.mjs
bun scripts/v3/verify-subtrees.mjs
deno run --allow-read scripts/v3/verify-subtrees.mjs
node --expose-gc scripts/v3/verify-subtree-memory.mjs text end
bun scripts/v3/verify-subtree-memory.mjs bytes error
node scripts/v3/benchmark.mjs --engine node --baseline /path/to/alpha2/dist/esm/v3/index.js --baseline-api callback --baseline-label alpha2 --same-path --format json --input bytes --sizes 128,65536 --pairs 3 --warmups 128 --iterations 24 --cpu --cases 'discarded metadata/ids,objects/missing,llm/string'
```

Use `--engine bun` for Bun and `--input text` for text. For JSON5 controls use
`--format json5 --syntax json5`. Memory diagnostics accept input, lifecycle and
an optional built module path; GC is enabled only for those diagnostics.

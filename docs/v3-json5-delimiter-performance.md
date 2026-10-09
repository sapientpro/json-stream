# JSON5 token and delimiter scanning

Baseline: PR27, `ba84e17`. JSON5 token boundary searches use
`RegExp.test()` and the regex's `lastIndex` instead of allocating a match array
with `exec()`. Token completion and syntax-error handling are methods rather
than closures created by each scanner invocation. The token boundary search
is also a separate method; string delimiter searches retain `exec()`.
Token validation, numeric conversion and synchronous fragment delivery retain their existing behavior.
The strict JSON scanner is unchanged.

## Measurement protocol

Serial fresh processes, three alternating baseline/candidate pairs, seven
samples per process. Parser creation, subscriptions, concrete callback paths,
write and end are included. Inputs are prepared outside the timed region;
values and concatenated string fragments are checked. Throughput uses wall time
and decimal MB/s. JSON5 fixtures contain comments, unquoted keys and a trailing
comma. LLM strings contain Ukrainian text, emoji, escaped newlines, quotes and
backslashes.

Prototype confirmation uses 1,024 warmup parses and 64 parses per sample.
The final built module is checked with the shipped benchmark worker using
512 warmups, 64 parses per sample and three alternating pairs. Earlier
256-warmup screens had unstable results for large string chunks; they are not
used as evidence of a uniform gain. Separate controls cover strict JSON,
UTF-8 input and variable chunks of 1–48 Unicode code points.

## Final built-module confirmation

Text chunk sizes count UTF-16 code units; byte input counts bytes.
Token-pattern input uses 1,3,8,2,16,4,32,5,48,7 Unicode code points per chunk.
Deltas compare median process throughputs; pair ranges compare each alternating
baseline/candidate pair separately. These can differ when throughput varies
between runs.

Objects contain 8,000 nested records with id, name, active, tags and score.
`ids` selects each `items[*].id`; `missing` registers 100 unmatched paths.
Numeric and short-string arrays contain 40,000 elements. `llm` streams only
the text field. Text rows use UTF-16 units; `*-bytes` rows use KiB.

| Runtime | Workload | Baseline MB/s | Candidate MB/s | Δ | Pair range |
|---|---|---:|---:|---:|---:|
| node | json5-objects / 1 Ki units | 98.3 | 106.4 | +8.2% | +2.1%…+12.2% |
| node | json5-ids / 1 Ki units | 93.7 | 100.8 | +7.6% | +6.6%…+8.8% |
| node | json5-decimals / 64 Ki units | 147.0 | 152.3 | +3.6% | +3.0%…+4.3% |
| node | json5-missing / 1 Ki units | 108.1 | 118.1 | +9.2% | +5.1%…+11.9% |
| node | json5-llm-1K / 1 Ki units | 296.0 | 309.7 | +4.7% | +2.3%…+5.6% |
| node | json5-llm-64K / 64 Ki units | 306.9 | 313.6 | +2.2% | -0.3%…+2.2% |
| node | json5-short-escaped / 1 Ki units | 149.2 | 157.5 | +5.6% | +5.1%…+6.1% |
| node | json5-token-text / 1–48 code points | 146.1 | 150.9 | +3.3% | +2.2%…+3.9% |
| node | json5-token-bytes / 1–48 code points | 75.4 | 73.9 | -2.0% | -2.3%…+1.4% |
| node | json5-objects-bytes / 1 Ki units | 95.6 | 105.7 | +10.6% | +8.4%…+11.5% |
| node | json-objects / 1 Ki units | 134.0 | 135.0 | +0.7% | -1.1%…+2.7% |
| node | json-llm / 64 Ki units | 770.6 | 782.0 | +1.5% | -1.4%…+3.9% |
| bun | json5-objects / 1 Ki units | 77.2 | 94.4 | +22.2% | +20.5%…+26.7% |
| bun | json5-ids / 1 Ki units | 91.6 | 108.7 | +18.7% | +16.1%…+18.7% |
| bun | json5-decimals / 64 Ki units | 165.2 | 177.2 | +7.3% | +6.2%…+8.0% |
| bun | json5-missing / 1 Ki units | 127.2 | 146.6 | +15.3% | +15.3%…+20.1% |
| bun | json5-llm-1K / 1 Ki units | 418.2 | 418.0 | 0.0% | -1.0%…+3.8% |
| bun | json5-llm-64K / 64 Ki units | 341.0 | 337.5 | -1.0% | -4.4%…+9.4% |
| bun | json5-short-escaped / 1 Ki units | 181.3 | 182.6 | +0.8% | -4.3%…+0.8% |
| bun | json5-token-text / 1–48 code points | 166.6 | 195.9 | +17.6% | +12.9%…+18.1% |
| bun | json5-token-bytes / 1–48 code points | 103.5 | 114.4 | +10.5% | +8.2%…+18.7% |
| bun | json5-objects-bytes / 1 Ki units | 77.6 | 95.2 | +22.7% | +20.9%…+23.7% |
| bun | json-objects / 1 Ki units | 188.2 | 183.1 | -2.7% | -6.6%…+2.7% |
| bun | json-llm / 64 Ki units | 362.6 | 365.2 | +0.7% | -3.0%…+1.3% |

The strongest repeatable gains are JSON5 objects, selected IDs and missing-path
workloads. Node token-sized UTF-8 is about 2% slower by process medians. Bun
large-string and short-escape controls have mixed positive/negative pairs;
these measurements do not establish zero regression or a general string gain.
Strict JSON controls are included despite an unchanged strict scanner; the
Bun object median is -2.7%, with pairs from -6.6% to +2.7%. This is not
evidence of a strict JSON speedup.

## Node 22 and 24 confirmation

Same final built module, serial workers, 512 warmups, 7×64 parses and three
alternating pairs. Actual JSON5 syntax, text input. Large LLM chunks remain
a control rather than an established benefit.

| Runtime | Workload / chunk | Baseline MB/s | Candidate MB/s | Δ | Pair range |
|---|---|---:|---:|---:|---:|
| node22 | objects/root / 1 Ki UTF-16 units | 82.5 | 92.3 | +11.8% | +8.6%…+13.5% |
| node22 | decimals/scalar / 64 Ki UTF-16 units | 106.8 | 108.6 | +1.7% | +1.1%…+5.4% |
| node22 | llm/string / 64 Ki UTF-16 units | 243.5 | 248.6 | +2.1% | -0.1%…+2.7% |
| node24 | objects/root / 1 Ki UTF-16 units | 96.3 | 103.1 | +7.0% | +6.4%…+11.3% |
| node24 | decimals/scalar / 64 Ki UTF-16 units | 135.3 | 141.4 | +4.5% | +2.2%…+6.7% |
| node24 | llm/string / 64 Ki UTF-16 units | 265.8 | 271.2 | +2.0% | -4.0%…+4.0% |


## Reproduce

Build a baseline checkout at `ba84e17`, then build the candidate. For example:

```sh
node scripts/benchmark.mjs --engine node --baseline /path/to/baseline/dist/esm/v3/index.js --baseline-api callback --baseline-label PR27 --format json5 --syntax json5 --cases objects/root,objects/ids,decimals/scalar,llm/string --sizes 1024,65536 --input text --pairs 3 --warmups 512 --iterations 64 --output /tmp/json5-delimiters-node.json
```

Use `--engine bun` for Bun. For token-sized LLM input, select `llm/string`,
`--chunk-unit codepoint --chunk-pattern 1,3,8,2,16,4,32,5,48,7`, and use
`--input text` or `--input bytes`. The public benchmark and local confirmation
use the same workload definitions.

## Validation and alternatives

Build, 404 tests across 23 suites, and 44,800 format-oracle checks pass.
Baseline differential checks pass 4,064 cases on each of Node and Bun, including
values, callback paths, invalid syntax and error offsets, cancellation and
UTF boundaries. The full test suite covers callback failures and reset/framing.
New tests split Unicode identifiers, JSON5 whitespace, signed
hex values, nonfinite numbers, string escapes and CRLF continuations at every
text and byte position.

Array append and root-context setup alternatives were tested separately and
parked after repeat measurements showed Bun regressions or gains that did not
survive longer warmup. Neither is included here.
Replacing string delimiter `exec()` or inlining the
token boundary search also produced worse large-string controls; those
variants were discarded. Experimental variants and raw
measurements remain in ignored local notes.

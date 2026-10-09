# Paths inside unused branches

The parser now updates concrete paths only while the current container's selector
context is nonempty. Unused descendants still undergo the same lexical/structural
validation, depth checks and requested value construction. Array counts still
advance normally, preserving strict trailing-comma rejection. No public API changes.

For a subscription to `$.items[*].id`, an `items` element's unrelated nested
metadata no longer pushes/pops property names and array indexes. Returning to
`id`, the next item or a selected sibling restores the original concrete path.
An ancestor root subscription still builds its complete value; `Rest` and `Any`
contexts continue to track all paths they can match.

## Accepted variant: natural GC

Measured 2026-10-08 against PR34 (`04c93b8`), serial fresh processes at the same
staged module path. Five rotating pairs, seven samples per worker, 128 warmup
parses, 32 parses/sample. UTF-8 input, 65,536-byte chunks; LLM uses 128-byte chunks.
Tables are medians of the five worker medians in decimal MB/s. Wall and process
CPU samples are both recorded by the existing benchmark driver.

| Runtime / format | Workload | PR34 | Candidate | Change |
|---|---|---:|---:|---:|
| Node JSON | Discard nested metadata; emit IDs | 172.2 | 186.5 | +8.3% |
| Node JSON | Complete items | 178.7 | 176.8 | −1.1% |
| Node JSON | LLM string fragments | 186.6 | 187.8 | +0.6% |
| Node JSON5 | Discard nested metadata; emit IDs | 190.5 | 194.0 | +1.8% |
| Node JSON5 | Complete items | 134.8 | 136.4 | +1.2% |
| Node JSON5 | LLM string fragments | 193.0 | 193.7 | +0.4% |
| Bun JSON | Discard nested metadata; emit IDs | 238.8 | 235.7 | −1.3% |
| Bun JSON | Complete items | 223.9 | 218.1 | −2.6% |
| Bun JSON | LLM string fragments | 296.2 | 299.7 | +1.2% |
| Bun JSON5 | Discard nested metadata; emit IDs | 210.5 | 212.5 | +1.0% |
| Bun JSON5 | Complete items | 135.3 | 134.0 | −0.9% |
| Bun JSON5 | LLM string fragments | 271.7 | 267.1 | −1.7% |

This is a targeted Node JSON improvement. Bun controls vary substantially between
fresh workers: JSON items baseline 218.1–256.5 MB/s, candidate 216.0–239.2 MB/s.
The −2.6% median is included rather than hidden; the data do not establish that
Bun is unaffected. Do not extrapolate the +8.3% to root parsing or all runtimes.

An exploratory variant also stopped advancing unused array indexes after the
first value. It did not improve Bun and was dropped. The accepted variant retains
the original counter operation and skips only concrete-path maintenance.

## Verification and reproduction

452 Jest tests pass. Node and Bun each pass 22,400 differential JSON/JSON5 checks.
New tests cover unused nested arrays/objects before selected siblings, saved paths,
UTF-8 chunk cuts, reset, root-plus-selected retention, terminal Rest and strict
trailing commas inside unused arrays.

Freeze the PR34 ESM directory with a `package.json` containing `{"type":"module"}`,
then use the existing driver, for example:

```sh
node scripts/benchmark.mjs --engine node --baseline /absolute/path/to/pr34/index.js \
  --baseline-api callback --baseline-label pr34 --same-path --cpu \
  --pairs 5 --warmups 128 --iterations 32 --format json --input bytes \
  --sizes 65536 --cases 'discarded metadata/ids,objects/items' \
  --output notes/path-benchmark.json
```

Repeat with `--engine bun`, and with `--format json5 --syntax json5`.
Use `--sizes 128 --cases llm/string` for the fragment control. No forced GC is
used in throughput runs; local prototypes and raw results stay under ignored notes.

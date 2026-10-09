# Approximate parser throughput

Snapshot: 2026-10-09, source `ea41dbc` (post-alpha.3 review fixes), Apple M4 Pro,
Node 26.11.0 and Bun 1.4.2. Values are **decimal MB/s** (1 MB = 1,000,000 bytes),
not megabits/s. These are local estimates, not performance guarantees.

| Parser | Workload / consumer | Text chunk, UTF-16 units | Node MB/s | Bun MB/s |
|---|---|---:|---:|---:|
| JSON | decimals / scalar | 65,536 | ~185 | ~280 |
| JSON | objects / root | 65,536 | ~180 | ~265 |
| JSON | objects / ids | 65,536 | ~170 | ~240 |
| JSON | objects / missing | 65,536 | ~345 | ~685 |
| JSON | llm / string | 65,536 | ~855 | ~405 |
| JSON | llm / string | 32 | ~230 | ~360 |
| JSON5 | literals / scalar | 65,536 | ~150 | ~140 |
| JSON5 | objects / root | 65,536 | ~155 | ~180 |
| JSON5 | objects / ids | 65,536 | ~155 | ~185 |

`root` retains the complete value via `$`; `ids` selects object IDs; `missing`
validates a document without retaining unmatched values; `scalar` consumes each
selected scalar; `string` consumes decoded fragments. LLM fixtures contain Unicode
and escaped text. Fixture definitions live in `scripts/benchmark-worker.mjs`.

Measurements cover the string-only core in default `memoryMode: 'fast'`. They
include parser construction, subscriptions, synchronous writes and completion;
UTF-8 decoding and Web/Node stream scheduling are excluded. Prepared input and
correctness checks precede timing. Fresh workers run serially with natural GC,
120 warmups and seven samples of 16 parses, across three alternating process pairs.
Rounded values hide small differences; runtime/JIT variation can be substantial,
especially for Bun object workloads. Both parsers consume the same strict-JSON fixtures here; JSON5-specific grammar
is not measured in this snapshot.
Compact mode trades throughput for reduced retained source memory; see
[its API and limitations](v3-copying.md).

## Reproduce

```sh
npm run build
node scripts/benchmark.mjs --engine node --format json --sizes 32,65536
node scripts/benchmark.mjs --engine bun --format json --sizes 32,65536
# JSON5 parser on the same JSON fixtures:
node scripts/benchmark.mjs --engine node --format json5 --sizes 65536
```

Run benchmarks one at a time on an otherwise idle machine. Outputs and detailed
experiment reports belong in ignored `notes/`; update this snapshot only from
verified current results. `--gc forced` is a separate diagnostic workload and must
not be mixed into this table. Production code never invokes GC.

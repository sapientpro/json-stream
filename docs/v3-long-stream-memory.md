# Long-stream lifecycle and retained-memory checks

Measured on 2026-10-09 against the parser in `main` (`fbe36c4`,
`3.0.0-alpha.2`), using Node 26.11.0 and Bun 1.4.2.
This is an optional correctness and retained-memory diagnostic, not a throughput
benchmark. It does not change the parser or its public API.

## Coverage

The runner executes 72 serial, isolated processes: two engines × three managers
(core parser with `reset()`, JSON Lines, prefix manager) × JSON/JSON5 × text/bytes
× three consumer lifecycles. Each process parses 20,000 documents, for a total of
**1,440,000 documents**.

Each record contains an unused branch with a changing key and a selected object.
Its string repeats Unicode, an astral character, escapes and the prefix text, and
ends with a lone surrogate. Input sizes rotate through 8, 32 and 128 UTF-16 units
for text, or bytes for encoded input. Chunk boundaries vary by record. Prefix text
inside a string must not start another document.

The three consumer lifecycles are:

- Normal string callbacks: reconstruct and validate every string, its concrete
  path and its end notification.
- Cancellation: unsubscribe on the first fragment; selected object callbacks
  continue for all remaining records.
- Unread string stream: a four-chunk queue overflows with `RangeError`; selected
  object callbacks continue for all records.

All modes validate selected values and paths. Managers also validate record
indices/counts. Eight retained results and paths are checked again after parsing.
Observer errors must remain absent. Every input is closed through `end()`, and
the parser must report that it is closed. Core parsers reset between records; the
last record is validated by `end()`. Byte cases use `createDecodedInput()`: the
core receives strings only, while managers preserve their own decoding policy.
The normal-consumer cases delivered 1,773,290 fragments per engine.

JSON Lines uses strict JSON by default. The JSON5 cases explicitly opt into the
existing extension and keep each record on **one physical line**; they do not
claim that JSON5 is standard JSON Lines.

## Observations

Snapshots follow three forced collections, with event-loop turns between them.
They are taken before input, after 1,000, 5,000 and 20,000 records, and after
closing the parser. The parser and eight retained results remain live.

| Engine | Largest heap growth from 1,000 to 20,000 records, across 36 cases |
| --- | ---: |
| Node | 0.101 MiB |
| Bun | 0.053 MiB |

All 72 cases passed. These fixtures showed no sustained retained-heap growth
proportional to record count. The numbers are observations, not portable test
thresholds or a proof of bounded memory for arbitrary inputs and consumers.
Snapshots include external memory, array buffers and RSS separately; those
figures may overlap and must not be summed. RSS changes are not by themselves
evidence of a leak. This diagnostic does not measure transient allocation peaks.

Consumer-held slices of a very large input chunk are a separate issue: short
string outputs can retain their backing source on some engines. These small-chunk
fixtures do not resolve that case. Large roots, unbounded consumer collections,
other queue limits and application-level retention need their own measurements.

## Reproduce

```sh
npm run build
node scripts/v3/verify-long-streams.mjs
# Or only Node, with a chosen output file:
node scripts/v3/verify-long-streams.mjs --engines node --output notes/analysis/v3-long-streams/node.json
```

The default output is `notes/analysis/v3-long-streams/results.json`. The parent
starts fresh workers sequentially, using the `node` and `bun` executables on PATH.
Node workers enable `--expose-gc`; Bun workers use `Bun.gc(true)`. Forced GC exists
only in this diagnostic, never in the library. Ordinary performance benchmarks
continue to use natural GC. No additional dependency is required.

# Opt-in copying of short string results (unreleased)

`@sapientpro/json-stream/copying` provides a core JSON/JSON5 parser facade for
**sparse short string outputs from large input chunks**. It is an unreleased
addition, not part of the `3.0.0-alpha.2` tag.

```ts
import {createCopyingParser} from '@sapientpro/json-stream/copying';

const parser = createCopyingParser();
const label = parser.getValue<string>('$.label');
// Feed input directly, through parser.writable, or createNodeWritable(parser).
parser.write(largeTextChunk);
parser.end();
console.log(await label);
```

The main package's `JsonParser`, `Json5Parser` and `createParser` keep their
existing behavior and code. The optional module is not imported by the default
entry. It implements the public `Parser` interface, including callbacks,
`getValue`, decoded string streaming, `reset`, `json`, Web input and Node's
`createNodeWritable(parser)` adapter. The factory returns a facade, not a scanner
subclass. JSONL/prefix managers have their own parsers and do not use this policy.

## Policy

After a write of at least `minInputLength`, scalar strings delivered through
`onValue`/`getValue`, and fragments delivered through `onString`/`stringStream`,
are copied when their length is at most `maxCopyLength`. Copying happens before
callbacks run or string fragments enter the Web queue. Unicode contents and lone
UTF-16 surrogates are preserved.

| Option | Default | Meaning |
| --- | ---: | --- |
| `minInputLength` | 65536 | Input UTF-16 units (the core accepts strings) |
| `maxCopyLength` | 128 | Maximum output UTF-16 units to copy |

The core accepts only strings. Web/Node wrappers, or `createDecodedInput(parser)`,
decode bytes before passing text to this facade. The input threshold therefore
always measures decoded UTF-16 units.

The threshold uses the visible chunk length, not its backing storage size. For
pre-sliced input borrowed from a larger string, set `minInputLength: 1` to copy
every short output. This increases copying work.

Both limits must be positive safe integers. Standard `FormatOptions`, including
`format: 'json5'`, `maxBufferedChunks`, `maxDepth`, `collectJson` and
`onObserverError`, are forwarded to the parser. `reset()` validates the previous
document and clears the large-input flag while preserving active subscriptions.

This is **not a deep-copy API**: objects, arrays, their nested strings, longer
scalar strings and collected raw JSON are forwarded unchanged. Path ownership,
synchronous callbacks, cancellation and error handling follow the core API.

## Why use it

Some engines retain the backing storage of a large string when a consumer keeps
only a tiny substring. The optional facade joins two nonempty parts into another string, avoiding that
retention in the measured engines. Empty and one-unit strings have separate
paths; lone surrogates are preserved. This replaces the original per-code-unit
`split('').join('')` implementation. The normal parser keeps its performance-oriented allocation policy.

In 48 current retained-memory probes on Node 26.11.0 and Bun 1.4.2, four small
outputs were retained from four large inputs, after the parsers finished:

| Case | Ordinary parser | Copying facade |
| --- | ---: | ---: |
| Node, text string fragments, retained heap | ~64.1 MiB | ~0.14 MiB |
| Node, byte string fragments, retained external memory | ~32 MiB | ~0 MiB |
| Bun, text/bytes, scalar strings or fragments, retained heap | ~64.2 MiB | ~0.18–0.21 MiB |

Node's scalar selected strings already detached in this fixture. The earlier prototype also had 64
fresh probes covering ASCII/Unicode outputs of 1, 4, 12 and 128 units with text and
byte input. The copying cases stayed below 0.22 MiB additional retained heap.
These are forced-GC diagnostics, not peak-allocation measurements or a portable
ECMAScript storage guarantee. Heap/external figures can overlap and must not be
summed.

Copying allocates work and memory. Dense selections with many short outputs can
be substantially slower, and can allocate more than retaining the input. Small
LLM input chunks normally do not need this policy; use the ordinary parser when
source retention is not a problem. Ordinary parser modules remain unchanged.

[Full throughput table and raw samples](v3-copying-performance.md) distinguish
the current two-part implementation from the historical split/join prototype.
Copying remains an opt-in memory tradeoff; a faster copy primitive does not
eliminate its cost or the forwarding overhead on small LLM chunks.

## Reproduce

```sh
npm run build
npm run test:copying
node --expose-gc scripts/v3/verify-string-memory.mjs json text fragments end dist/esm/v3/index.js
node --expose-gc scripts/v3/verify-string-memory.mjs json text fragments end dist/esm/v3/copying.js
bun scripts/v3/verify-string-memory.mjs json bytes selective end dist/esm/v3/copying.js
# Optional output width and alphabet for tiny fragments:
bun scripts/v3/verify-string-memory.mjs json text fragments end dist/esm/v3/copying.js 1 unicode
node scripts/v3/benchmark.mjs --engine node --baseline dist/esm/v3/copying.js --baseline-api callback --baseline-label copying --format json --input text --sizes 128,65536 --cases 'llm/string,short strings/scalar'
```

The benchmark labels `copying` as its baseline series and `3.0 JSON` as the
ordinary series. Both import the same scanner files. For independently built baselines, use
`--same-path` to stage each version at the same canonical path in serial workers. Timing uses natural GC. Memory diagnostics enable GC only in their own
processes. Registration must happen before the first write, as in the core API.

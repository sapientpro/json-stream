# Optional compact memory mode (unreleased)

Use `memoryMode: 'compact'` when keeping short string results or streamed
fragments from large input chunks retains too much source storage. The default
is `'fast'`. This option is not part of the `3.0.0-alpha.2` tag.

```ts
import {JsonParser, Json5Parser, JsonLinesParser, PrefixedJsonParser} from '@sapientpro/json-stream';

const parser = new JsonParser({memoryMode: 'compact'});
const label = parser.getValue<string>('$.label');
parser.write(largeTextChunk);
parser.end();
console.log(await label);

const json5 = new Json5Parser({memoryMode: 'compact'});
const jsonl = new JsonLinesParser({memoryMode: 'compact'});
const prefixed = new PrefixedJsonParser('```json', {memoryMode: 'compact'});
```

`createParser({format: 'json5', memoryMode: 'compact'})` and Node's
`new JsonStream({memoryMode: 'compact'})` support the same option. Web/Node input
wrappers and `createDecodedInput(parser)` decode bytes before parsing; the core
accepts strings only. Callbacks and string streaming remain synchronous inside
`write()`. Consumers still control input pacing.

## Copying policy and limits

After an input write of at least **65,536 UTF-16 code units**, compact mode copies
scalar string values and streamed string fragments of at most **128 UTF-16 code
units**. It copies once per selector channel before calling its consumers or
queueing fragments in a Web string stream. Empty and one-unit strings have
special paths; longer copied results join two nonempty parts. Unicode contents,
including lone surrogates, are preserved.

These thresholds are fixed in this version. `reset()` validates the current
document and clears large-input tracking, preserving active consumers. JSONL and
prefix managers apply the policy to their own record parsers; they also accept
byte input.

This is **not a deep-copy mode**. Containers, nested strings inside container
results, path keys, long scalar strings and `collectJson` storage are unchanged.
Subscribing to `$` can therefore still retain nested sliced strings. An additional
scalar/string subscription copies its own output without modifying the container.

The input threshold measures the visible decoded string, not the size of its
backing storage. Small pre-sliced inputs from a huge string may retain that
storage without activating copying. Compact mode does not guarantee independent
storage on every JavaScript engine or lower peak memory/RSS.

## Cost and measured benefit

In the retained-fragment diagnostic, four saved short results from large documents
kept approximately **64 MiB** alive in normal mode. Compact mode reduced the worst
retained heap delta to **0.15 MiB in Node** and **0.20 MiB in Bun**. Some selected
scalar controls already released the source without copying. Forced GC is used
only by this diagnostic. Bun heap/external measurements overlap and must not be
added together.

Copying has a substantial throughput cost on dense short-string selections.
Small LLM input chunks usually do not activate copying, but compact mode still
adds forwarding through its input method and string channels. Prefer the default
mode unless retained source storage is a measured problem.

The mode is selected at construction/subscription time. Normal `write()` and
`CallbackChannel.next()` have no memory-mode condition, although setup and code
layout can still affect normal-mode timings. See the
[performance controls and raw samples](v3-copying-performance.md), including
regressions. This replaces the earlier, unreleased `/copying` facade; that entry
point and its configurable thresholds are not exported.

## Reproduce

```sh
npm run build
npm run test:copying
# Compare normal and compact retained string-fragment storage:
node --expose-gc scripts/v3/verify-string-memory.mjs json text fragments end dist/esm/v3/index.js
node --expose-gc scripts/v3/verify-string-memory.mjs json text fragments end dist/esm/v3/index.js 128 unicode compact
# Direct parser throughput, natural GC:
node scripts/v3/benchmark.mjs --engine node --format json --input text --memory-mode compact --sizes 32,65536 --cases 'llm/string,short strings/scalar'
# Same-path normal/compact controls against an independently built v3 baseline:
node scripts/v3/benchmark-memory-mode.mjs --baseline /path/to/baseline/v3/index.js --output /tmp/memory-mode.json
```

The memory diagnostic's optional final argument is `fast` or `compact`; width and
alphabet arguments must precede it. Bytes are decoded outside the core. All
throughput controls use natural GC; no production code invokes GC.

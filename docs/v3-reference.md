# 3.0 API reference

For complete examples, start with the [usage guide](v3.md).
This reference describes **3.0.0**. Core parsers accept final text in `end(text?)`;
record managers, `PrefixFilter` and `createDecodedInput` also accept final UTF-8
bytes in `end(chunk?)`, following the same input mode as `write()`.

## Choose an input

| API | Purpose | Input |
| --- | --- | --- |
| `new JsonParser(options?)` | One strict JSON document | Strings |
| `new Json5Parser(options?)` | One JSON5 document | Strings |
| `createParser({format, ...options})` | Choose one of those parsers dynamically | Strings |
| `new JsonLinesParser(options?)` | LF-delimited records; strict JSON by default | Strings or UTF-8 bytes |
| `new PrefixedJsonParser(marker, options?)` | Seek a marker before each complete JSON/JSON5 document | Strings or UTF-8 bytes |
| `new PrefixFilter(target, marker)` | Discard input through the first marker | Strings or UTF-8 bytes |
| `createDecodedInput(target)` | Synchronous UTF-8 adapter around an existing input | Strings or UTF-8 bytes |
| `parser.writable` / `createWritableStream(target)` | Web input transport | Strings or UTF-8 bytes |
| `new JsonStream(options?)` | Node writable plus value/string subscriptions | Strings or Buffer/UTF-8 bytes |
| `createNodeWritable(target)` | Node writable around an existing input | Strings or Buffer/UTF-8 bytes |

Node exports live at `@sapientpro/json-stream/node`; other APIs use the package
root. Each byte-capable input owns one decoding sequence. Do not mix text and
bytes on it, including its optional final chunk. Invalid/truncated UTF-8 fails.

## Methods and lifecycle

| Method | Contract |
| --- | --- |
| `onValue<T>(path, callbackOrObserver)` | Complete selected values; register before input; returns `{unsubscribe()}` |
| `getValue<T>(path = '$')` | First match, not successful EOF; pending promise rejects on failure or absence |
| `onString(path, callbackOrObserver)` | Decoded fragments; `end(path)` separates strings; no implicit whole-string retention |
| `stringStream(path)` | Web readable concatenating all matching string fragments without boundary markers |
| `write(chunk)` | Process synchronously; callbacks finish before return; does not await async consumer work |
| `end(finalChunk?)` | Equivalent to `write(finalChunk)` then `end()` when an argument is supplied; flush decoding, validate EOF, complete consumers |
| `destroy(error?)` | Cancel with Error or AbortError; no successful completion event |
| `reset()` | Core only: validate current document and start another with active subscriptions; use before final `end()` |
| `onRecord(callback)` | Managers only: subscribe to each root, building that complete record |

Core `write()`/`end()` return unread UTF-16 unit counts, normally zero. Managers,
filters and decoded adapters return `void`; native Node methods keep their usual
return values. See [managed boundaries](v3-advanced.md#document-boundaries) for
`strictEnd: false`. Omitted `end()` arguments never add a chunk; an empty string
or empty Uint8Array is still a write and follows the input-mode/lifecycle rules.

Callbacks receive `(value, concretePath)`; manager callbacks also receive a
zero-based `recordIndex`. Paths are owned readonly snapshots and may be shared
between consumers. `T` is a consumer type assertion, not runtime schema validation.
An observer has `next`, optional `error` and `complete`; string observers also use
`end(path[, recordIndex])`. `complete` means successful whole-input EOF, not each
value/record. See [error ownership](v3.md#errors-and-cancellation).

| Property | Available on | Meaning |
| --- | --- | --- |
| `rootReady` | Core, JsonStream | Root structure complete; later input/EOF may still fail |
| `finished` | Core, record managers, PrefixFilter | Successful input EOF |
| `closed` | Core, record managers, PrefixFilter | Ended, failed or canceled; does not imply success |
| `json` | Core, JsonStream | Collected decoded text, or `''` by default; not a parsed object |
| `recordCount` | Record managers | Successfully validated records |
| `parsed` | JsonStream | Successful parser EOF; native `writableFinished` separately describes the writable |

A delivered value or fulfilled `getValue()` is never revoked by later errors.
For validated results, await input completion as well. No replay or new consumer
registration is supported after input starts, even across `reset()`.

## Options and defaults

| Option | Default | Meaning |
| --- | --- | --- |
| `format` | `'json'` | `'json'` or `'json5'`; factory, managers and JsonStream only; constructors choose their own grammar |
| `memoryMode` | `'fast'` | `'compact'` copies selected short strings/fragments after large writes at a throughput cost; [limits](v3-copying.md) |
| `collectJson` | `false` | Retain decoded source text for `.json`; independent of selected values and not bounded input memory |
| `strictEnd` | `true` | Core validates all trailing input; `false` returns document suffixes for a manager |
| `maxDepth` | `1000` | Maximum container nesting; nonnegative safe integer or `Infinity` |
| `maxBufferedChunks` | `Infinity` | Positive safe integer or `Infinity`; pending fragments per `stringStream`, not input backpressure |
| `onObserverError` | Microtask rethrow | Handles synchronous observer exceptions only; async rejections remain consumer-owned |

JSONL forces `strictEnd: true`; the prefix manager forces `false`. Managers accept
core options but do not expose collected `.json`, so leave `collectJson` disabled
there. `getValue()` or `onValue('$', ...)` builds the whole value; `collectJson`
is not required. String-only subscriptions do not retain complete strings.

## Paths and advanced APIs

A path is either JSONPath starting with `$` or a typed selector array. Use numeric
array indexes and string object properties: `[0]` differs from `['0']`. `Any`
matches one segment; `Rest` searches descendants. See the [supported subset and
streaming order](v3.md#paths-and-jsonpath).

`compileJsonPath(query)` validates and freezes a reusable path.
`compileSelectors(definitions)` prepares a repeated layout; its `bind(parser,
callbacks)` requires callbacks in definition order and returns cancellation
handles. See [subscription plans](v3-advanced.md#reusing-a-subscription-plan).

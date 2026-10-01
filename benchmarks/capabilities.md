# Capability matrix

Audited against installed versions on 2026-10-01. “Adapter” means possible by composing public APIs or writing consumer logic; it is not a built-in feature. Runtime benchmarks verify Node and Bun only; browser support is documented rather than tested here.

| Capability | @sapientpro/json-stream 2.0.0 | @streamparser/json 0.0.26 | stream-json 3.7.0 | json-web-streams 1.2.0 | json-stream-lite 1.3.1 |
|---|---|---|---|---|---|
| Incremental string input | Yes | Yes | Yes | Yes | Yes |
| UTF-8 bytes | Yes | Yes | Yes / decoder in core harness | TextDecoderStream adapter | Yes |
| Browser support | Yes | Yes | Web/core entry | Yes | Yes |
| Node / Bun | Both benchmarked | Both benchmarked | Both benchmarked | Both benchmarked | Both benchmarked |
| Runtime dependencies | 0 | 0 | 1: stream-chain | 2: schema spec + JSONPath | 0 |
| TypeScript declarations | Yes | Yes | Yes | Yes | Yes |
| Synchronous push parser | write/end | write/end | Public jsonParser core | No; TransformStream | feed + synchronous entity reads |
| Async pull consumption | Observable async iterator | Adapter / separate wrapper | Stream pipelines | Web Streams | Async entities / iterators |
| Exact path selection | Segment array / dotted path | Limited JSONPath | Path/regex/predicate filter | JSONPath subset | Manual entity traversal |
| Wildcard selection | Any | * | Regex/predicate | [*] | Manual traversal |
| Recursive descendant selection | Rest | Not in documented path subset | Regex/predicate filters | Not in documented subset | Recursive traversal / flattened keys |
| Multiple paths simultaneously | Independent observers | paths option | Compose filters/pipelines | Query array | Consumer traversal |
| Await one selected value | value(path) | Adapter | Adapter | Consume one stream result | Entity readAsync; manual traversal |
| Multicast Observable API | subscribe + RxJS interop | No | No | No | No |
| Decoded string fragments before completion | chunks / stream(path) | Cumulative partial previews, not independent fragments | stringChunk tokens | No documented API | JsonString.stream/streamAsync |
| Direct string stream by path | Yes; Any/Rest supported | Callback + paths + partial options | Filter + token pipeline | No | Traverse to JsonString |
| Memory bounded by selected subtree | retainRoot:false | paths + keepStack:false | Filters + streamers | Selective queries | Consume entities individually |
| Consumer backpressure | Push parser does not pause; optional queue overflow limit | Push core does not pause; wrappers available | Stream adapters / pipelines | TransformStream | Pull consumption |
| Partial/incomplete value snapshots | String fragments only | emitPartialTokens + emitPartialValues | Token stream | Completed values only | Incremental entity reads |
| Strict JSON validation | Deliberately lenient; ignores suffix | Declares JSON compliance | JSON parser / dedicated verifier | Tested against JSONTestSuite | Lenient: observed trailing commas/comments/suffix acceptance |
| Multiple top-level values / NDJSON | No | separator option | jsonStreaming / JSONL | multi option | Consumer-managed traversal; no equivalent mode confirmed |
| JSONC comments | No | No | Separate JSONC parser | No | Comment entities / traversal |
| Streaming stringify | No | No | Stringer/disassembler | No | Yes |
| Schema validation integration | Consumer callback | Consumer callback | Consumer pipeline | Standard Schema | Consumer callback |
| Start marker embedded in prose | start option | Preprocess | Preprocess | Preprocess | Preprocess |
| Configurable depth limit | maxDepth | No documented option | No documented parser option | No documented option | No documented option |

Sources: installed READMEs, declarations and public implementations, plus upstream documentation:

- [@streamparser/json](https://github.com/juanjoDiaz/streamparser-json/tree/main/packages/json): paths, keepStack, partial values, separator, encoding and wrappers.
- [stream-json](https://github.com/uhop/stream-json): core/Web/Node pipelines, tokens, filters, JSONC, JSONL and stringifier.
- [json-web-streams](https://github.com/zengm-games/json-web-streams): JSONPath subset, TransformStream, multi and Standard Schema.
- [json-stream-lite](https://github.com/jacobshirley/json-stream-lite): entity traversal, string streaming, buffers and stringify.

Package API capabilities do not guarantee correctness on every Unicode/escape boundary. The benchmark records correctness failures instead of reporting their timings as valid results.

Observed on 1.3.1: json-stream-lite decodes `"\uD83D\uDE00"` as two replacement characters and `"a\/b"` as `"ab"`. Streaming a string with an emoji crossing its 1024-byte output boundary also produces replacement characters. These checks are included in the benchmark's correctness probes.

# Capability matrix

Audited against the installed versions below on 2026-10-08. These are pinned
comparison versions, not claims about the newest releases. “Adapter” means
composition or consumer code. See [the measured comparison](../docs/v3-package-comparison.md)
for runtime coverage and Unicode boundary probes. `json-stream-lite` is excluded
from ongoing comparisons as requested; archived release reports remain unchanged.

| Capability | @sapientpro/json-stream 3.0.0-alpha.1 | @streamparser/json 0.0.26 | stream-json 3.7.0 | json-web-streams 1.2.0 |
|---|---|---|---|---|
| Input | Text / UTF-8 bytes | Text / UTF-8 bytes | Text core; byte decoder / transports | Text; TextDecoderStream for bytes |
| Browser / Node transports | Web and Node wrappers | Core; separate wrappers | Web / Node pipelines | Web Streams |
| Runtime dependencies | 0 | 0 | stream-chain | Standard Schema spec + JSONPath |
| TypeScript declarations | Yes | Yes | Yes | Yes |
| Synchronous push | write/end; callbacks run inside write | write/end | Public jsonParser core | No; TransformStream |
| Selected completed values | onValue / getValue | onValue + paths | Filters + assembler/streamers | JSONParseStream queries |
| Root retention | Only when subscribed to $ | paths + keepStack | Assembler / streamers | Selected value is buffered |
| JSONPath | Child-selector subset: $, names, typed [0], [*] | Root/dotted names/wildcards subset | Path / regex / predicate filters | Root/names/wildcards subset |
| Recursive matches | Terminal Rest in typed selector arrays | Not in documented subset | Regex / predicate filters | Not in documented subset |
| Filters / slices in JSONPath | Explicitly rejected | Not documented | Consumer filter pipeline | Not in documented subset |
| Independent decoded string fragments | onString; concrete path and end callback | Cumulative partial previews | stringChunk tokens; filter by path | No public API |
| String Web stream | stringStream(path) | Adapter | Token/Web pipeline | No |
| Concurrent consumers | Independent value/string subscriptions | paths array / consumer dispatch | Compose pipelines | Query array |
| Owned concrete callback paths | Yes; readonly snapshots | Key/stack references; copy if retaining | Consumer assembles path from tokens | Query/match metadata |
| Strict JSON | Separate strict scanner; end validates suffix | JSON parser | JSON parser plus dedicated verifier | JSON parser |
| JSON5 | Separate scanner | No documented mode | JSONC, not JSON5 | No documented mode |
| JSONL | Strict incremental manager; one physical line per record | separator option; not identical JSONL validation | JSONL components | multi values; not identical JSONL validation |
| Multiple prefixed documents | PrefixedJsonParser / PrefixFilter | Preprocess | Preprocess / pipelines | Preprocess / multi |
| Reset keeping consumers | reset() before end(); input type stays fixed | No documented equivalent | New pipeline instance | New stream instance |
| Backpressure | Caller paces writes; wrappers regulate input; callbacks not awaited | Caller paces push core; wrappers | Stream pipelines / public sync core | Web stream backpressure |
| Pending string queue bound | maxBufferedChunks; overflow unsubscribes | Consumer/wrapper policy | Pipeline queue policy | No fragment stream |
| Streaming stringify | No | No | Stringer / disassembler | No |
| Schema integration | Consumer callback | Consumer callback | Consumer pipeline | Standard Schema |
| Depth limit | maxDepth | No documented option | No documented parser option | No documented option |

JSONPath support here means each package's stated subset, not full RFC 9535.
Our numeric indexes distinguish array elements from numeric object keys. `Rest`
is a typed-array feature, not support for JSONPath descendant syntax `$..name`.

Backpressure is a scheduling/memory policy, not a single speed characteristic.
The benchmark includes Web stream scheduling for json-web-streams and uses public
synchronous cores for push parsers. Faster synchronous delivery does not imply
waiting for asynchronous consumers. Our callbacks must queue asynchronous work
and pace subsequent input writes themselves.

Sources: installed declarations and implementations, with upstream documentation:

- [Our 3.0 API](../docs/v3.md): values, string boundaries, selectors, transports and record managers.
- [@streamparser/json](https://github.com/juanjoDiaz/streamparser-json/tree/main/packages/json): paths, keepStack, partial values, separator and wrappers.
- [stream-json](https://github.com/uhop/stream-json): public core, Web/Node pipelines, filters, JSONC, JSONL and stringifier.
- [json-web-streams](https://github.com/zengm-games/json-web-streams): supported JSONPath subset, multi and Standard Schema.

The benchmark records unsupported operations and failed content checks instead
of presenting their timings as valid results. Its probes are boundary tests,
not a complete conformance suite for any competitor.

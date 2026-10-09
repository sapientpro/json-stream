# Json-stream

Incremental JSON and JSON5 parsing with selective value callbacks, streaming
strings, JSONPath selectors and Web/Node input adapters. No runtime dependencies.

This README documents the **3.0.0-alpha.3 preview**, with breaking changes from
2.x and earlier alphas. Core parsers accept strings; transports decode bytes.
For the stable 2.x API, see [2.0.1](https://github.com/sapientpro/json-stream/tree/2.0.1).

```ts
import {JsonParser} from '@sapientpro/json-stream';

const parser = new JsonParser();
parser.onValue('$.items[*].id', (value, path) => {
  console.log(value, path);
});
parser.write('{"items":[{"id":42}]}');
parser.end();
```

Register consumers before the first write. Callbacks run synchronously; the caller
controls input pacing. Use JSONL or prefix managers to consume multiple documents.
The core accepts strings; input adapters decode UTF-8 bytes. Subscribe to `$` or
call `getValue()` before writing to retain the complete root.

Selectors support names, typed array indexes, wildcards and recursive descent
such as `$..id` and `$..*`. Filters, slices, unions and negative indexes are
explicitly rejected. See [supported paths and streaming semantics](docs/v3.md#paths-and-jsonpath).

## Documentation

- [API, retention, paths and migration from 2.x](docs/v3.md)
- [Opt-in copying of short string results](docs/v3-copying.md)
- [Streaming strings and pacing](docs/v3.md#streaming-strings-and-pacing)
- [Web and Node transports](docs/v3.md#transports)
- [Reset and parser reuse](docs/v3.md#reusing-a-core-parser)
- [JSON Lines and prefixed documents](docs/v3.md#json-lines-and-prefixed-documents)
- [Architecture and tradeoffs](docs/v3-architecture.md)
- [Approximate current throughput (MB/s)](docs/performance.md)
- [Package capability matrix](benchmarks/capabilities.md)

## Development

```sh
npm run build
npm test -- --runInBand
npm run check
npm run test:formats
npm run benchmark
```

Biome provides `lint`, `format`, `format:check` and `check`. Its explicit file list
currently covers callback channels, framing/record managers and their new tests;
expand it as other files are cleaned up. Lazy assignments, existing generic `any`
defaults and checked array-index assertions are allowed.

Benchmarks include setup and use natural GC, serial workers and correctness checks. See [current throughput and reproduction](docs/performance.md). Detailed reports and raw samples stay in ignored `notes/`.
The current implementation lives in `src/`, with tests in `tests/` and tools in
`scripts/`. The 2.x implementation remains in its Git release tags rather than
this working tree.
`npm run benchmark` runs the current parser on Node and Bun; `benchmark:v3`
remains a compatibility alias.

MIT licensed.

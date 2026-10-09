# Json-stream

Incremental JSON and JSON5 parsing with selective value callbacks, streaming
strings, JSONPath selectors and Web/Node input adapters. No runtime dependencies.

This README documents **unreleased `main`**, with breaking changes from 2.x.
The source package version is still **3.0.0-alpha.2**; features merged after that
tag, including recursive JSONPath and compact memory mode, need a new release.
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
- [Opt-in copying of short string results (unreleased)](docs/v3-copying.md)
- [Streaming strings and pacing](docs/v3.md#streaming-strings-and-pacing)
- [Web and Node transports](docs/v3.md#transports)
- [Reset and parser reuse](docs/v3.md#reusing-a-core-parser)
- [JSON Lines and prefixed documents](docs/v3.md#json-lines-and-prefixed-documents)
- [Architecture and tradeoffs](docs/v3-architecture.md)
- [Performance measurements](docs/v3-performance.md)
- [Package comparison snapshot: Node, Bun and Deno](docs/v3-package-comparison.md)
- [Long-stream lifecycle and memory checks](docs/v3-long-stream-memory.md)
- [Package capability matrix](benchmarks/capabilities.md)
- [Subscription API before/after measurements](docs/v3-subscriptions-performance.md)

## Development

```sh
npm run build
npm test -- --runInBand
npm run test:formats
npm run benchmark
```

Benchmarks include setup and use natural GC, serial workers and correctness checks. See [benchmark GC modes](docs/v3-benchmark-methodology.md) for the separate forced-GC workload.
The current implementation lives in `src/`, with tests in `tests/` and tools in
`scripts/`. Archived 2.x sources, tests and tools live in `legacy/v2/`, are built
only by `npm run build:legacy`, and are excluded from the npm package.
Use `npm run test:legacy -- --runInBand` for the old regression suite; see
[legacy controls](legacy/v2/README.md). `npm run benchmark` runs the current parser
on Node and Bun; `benchmark:v3` remains a compatibility alias.

MIT licensed.

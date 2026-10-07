# Json-stream

Incremental JSON and JSON5 parsing with selective value callbacks, streaming
strings, JSONPath selectors and Web/Node input adapters. No runtime dependencies.

The 3.0 API is an **alpha preview**, with breaking changes from 2.x.
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

## Documentation

- [API, retention, paths and migration from 2.x](docs/v3.md)
- [Streaming strings and pacing](docs/v3.md#streaming-strings-and-pacing)
- [Web and Node transports](docs/v3.md#transports)
- [Reset and parser reuse](docs/v3.md#reusing-a-core-parser)
- [JSON Lines and prefixed documents](docs/v3.md#json-lines-and-prefixed-documents)
- [Architecture and tradeoffs](docs/v3-architecture.md)
- [Performance measurements](docs/v3-performance.md)
- [Current package comparison: Node, Bun and Deno](docs/v3-package-comparison.md)
- [Package capability matrix](benchmarks/capabilities.md)
- [Subscription API before/after measurements](docs/v3-subscriptions-performance.md)

## Development

```sh
npm run build
npm test -- --runInBand
npm run test:formats
npm run benchmark:v3
```

Benchmarks include setup and use natural GC, serial workers and correctness checks. See [benchmark GC modes](docs/v3-benchmark-methodology.md) for the separate forced-GC workload.
The 2.x sources remain as regression controls and are excluded from the v3 package.

MIT licensed.

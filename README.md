# Json-stream

Incremental JSON and JSON5 parsing with selective value callbacks, streaming
strings, JSONPath selectors and Web/Node input adapters. No runtime dependencies.

This README documents **3.0.0**, with breaking changes from 2.x. Core parsers
accept strings; transports decode bytes. See the [migration guide](docs/v3-migration.md).
For the previous 2.x API, see [2.0.1](https://github.com/sapientpro/json-stream/tree/2.0.1).

```sh
npm install @sapientpro/json-stream
```

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

## Stream a string as it arrives

```ts
import {JsonParser} from '@sapientpro/json-stream';

const parser = new JsonParser();
parser.onString('$.text', fragment => console.log(fragment));
parser.write('{"text":"Hello ');
parser.end('world 🌍"}');
```

Fragments are decoded text; their boundaries depend on input and escapes. No
complete string is retained unless a value consumer requests it too. Values and
fragments can arrive before a later syntax error; await input completion when
whole-document validity matters.

## Documentation

- [Usage: values, JSONPath, strings, Web/Node input and JSONL](docs/v3.md)
- [API reference: methods, lifecycle and option defaults](docs/v3-reference.md)
- [Advanced: reset, document boundaries and reusable plans](docs/v3-advanced.md)
- [Compact memory mode and its limits](docs/v3-copying.md)
- [Migration from 2.x](docs/v3-migration.md)
- [Approximate throughput](docs/performance.md) and [package comparison](benchmarks/capabilities.md)
- [Architecture](docs/v3-architecture.md), [contributing](CONTRIBUTING.md) and [security policy](SECURITY.md)

Documentation describes 3.0.0; later changes are tracked in the changelog.

MIT licensed.

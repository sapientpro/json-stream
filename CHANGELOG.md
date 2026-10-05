# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## 2.0.1

Compatible performance improvements over 2.0.0. Public imports, callback paths,
subscription behavior and parser options are unchanged.

### Performance

- Scan complete numeric tokens with a fast digit-run parser, preserving native
  number conversion and rounding and falling back for tokens split across writes.
- Use direct observer-trie lookups and dedicated wildcard edges; stop retention
  matching after finding a value consumer.
- Avoid accumulating strings that no consumer needs when `retainRoot: false`.
- Scan strings and locate delimiters without allocating match arrays.
- Recognize complete `true`, `false` and `null` literals at value entry.
- Decode complete Unicode escapes without building temporary hex strings, with
  a bounded adaptive code-unit cache on Bun.
- Notify value observers without allocating a closure for each notification.
- Preserve native private fields in the CommonJS build, matching the ES2022
  target used by the supported Node runtimes.

These changes retain incremental parsing, wildcard/chunk delivery and error
handling. Performance varies by runtime, data and chunk size; the release
[release benchmark report](https://github.com/sapientpro/json-stream/blob/main/benchmarks/releases/2.0.1.md)
includes regressions as well as improvements.

## 2.0.0

Relative to **1.1.4**, the last release on npm.

The parser was rewritten as a synchronous state machine, the runtime dependency on RxJS was removed, and the package now runs in browsers. `engines` stays at `node >=22`.

### Migration from 1.x

**1. The main import now gives you `JsonParser`, not `JsonStream`.**

`JsonStream` extends the Node `Writable`, which cannot work in a browser, so it moved to a subpath. The parser itself imports nothing.

```diff
-import { JsonStream, Any } from '@sapientpro/json-stream';
+import { JsonStream, Any } from '@sapientpro/json-stream/node';
```

Nothing else about `JsonStream` changed: it still extends `Writable`, still emits `'value'` and `'error'`, and still accepts `new JsonStream(start, collectJson)`.

Outside Node, use the parser directly:

```typescript
import { JsonParser, Any } from '@sapientpro/json-stream';

const parser = new JsonParser();
parser.observe(['items', Any]).subscribe({ next: ({ value }) => console.log(value) });
await (await fetch(url)).body.pipeTo(parser.writable);
```

**2. `stream(path)` returns a WHATWG `ReadableStream`, not a Node `Readable`.**

```diff
-jsonStream.stream('log').on('data', chunk => process.stdout.write(chunk));
+for await (const chunk of jsonStream.stream('log')) process.stdout.write(chunk);
```

To keep a Node stream, wrap it:

```typescript
import { Readable } from 'node:stream';

Readable.fromWeb(jsonStream.stream('log')).pipe(process.stdout);
```

**3. `observe()` no longer returns an RxJS Observable.**

`.subscribe({ next, error, complete })` is unchanged. `.pipe()` is gone, because RxJS is no longer a dependency. The returned source implements `@@observable`, so RxJS still consumes it directly:

```diff
-jsonStream.observe(['items', Any]).pipe(map(v => v.value)).subscribe(log);
+import { from, map } from 'rxjs';
+from(jsonStream.observe(['items', Any])).pipe(map(v => v.value)).subscribe(log);
```

RxJS now belongs in your own dependencies, and only if you want operators. `subscribe` and `for await` work without it.

**4. Remove `rxjs` from your dependencies** if you installed it only for this package.

### Breaking

- `@sapientpro/json-stream` resolves to `JsonParser`; `JsonStream` moved to `@sapientpro/json-stream/node`.
- `stream(path)` returns `ReadableStream<string>` instead of a Node `Readable`.
- `observe(path)` returns an in-house multicast source instead of an RxJS `Observable`. `subscribe` is source compatible; `pipe` is not.
- `rxjs` is no longer a dependency of this package.
- `stream(path)` on a path that already has a stream no longer throws `Stream already exists`. Sources are multicast, so several readers on one path each receive every fragment.
- `value(path)` for a path that never appears still rejects when the input ends, but with a plain `Error` instead of RxJS's `EmptyError`. Code matching on the error class or message needs updating.
- Nesting deeper than `maxDepth` (default 1000) is now rejected with a `SyntaxError`. 1.1.4 parsed arbitrarily deep documents, at the cost of quadratic memory. Raise `maxDepth` if you legitimately parse deeper.
- `Emitted.path` is typed `PathSegment[]` (`(string | number)[]`) instead of `string[]`. The runtime already put numbers there for array indices; only the type was wrong.

### Added

- `JsonParser` - the parser with no `node:` imports, usable in browsers, Node and Bun. The shipped ESM core is 6.2 KB gzipped, 3.6 KB once a bundler minifies it.
- `parser.writable` - a `WritableStream` sink, so `response.body.pipeTo(parser.writable)` works.
- `for await` over `observe()`, `chunks()` and `stream()`.
- `chunks()` and `stream()` accept `Any` and `Rest` paths. Wildcards previously matched no strings at all.
- `retainRoot: false` - skip building containers nothing observes, for selecting a few items out of a large document.
- `maxBufferedChunks` - bound the queue of an async iterator or `ReadableStream` consumer.
- `onObserverError` - receive exceptions thrown by subscriber callbacks instead of letting them escape.
- `new JsonStream(options)` alongside the existing `new JsonStream(start, collectJson)`.
- `./package.json` is exported, so tooling can read the manifest.

### Fixed

- Negative numbers threw a `SyntaxError` instead of parsing.
- Multibyte characters straddling a chunk boundary were corrupted; input is now decoded with a streaming decoder.
- `Any` and `Rest` observers silently dropped values whenever an explicit sibling key was observed on the same path.
- A stream that ended without ever containing the `start` marker wedged the process at 100% CPU with no error.
- Deep nesting cost quadratic memory: 16 KB of `[` exhausted a 1 GB heap.
- A parse error left observers silent, `value()` unsettled and the in-flight write parked forever. Errors now destroy the stream and reach every observer.
- A key named `constructor` or `toString` crashed the parser with a `TypeError`.
- A key named `__proto__` replaced the object's prototype instead of becoming an own property, as `JSON.parse` makes it.
- `"\u41"` consumed the closing quote and whatever followed; `\u` escapes are now validated as four hex digits.
- `{ab":1}` parsed as `{"b":1}`.
- `collectJson` did nothing, and left the buffer untrimmed, making it quadratic.
- The ESM build could not be imported at all (`ERR_MODULE_NOT_FOUND`); only `require` worked.
- A `chunks()` fragment could end between the halves of a surrogate pair, so a consumer encoding each fragment separately got `U+FFFD`.
- `Subject.error(undefined)` reached subscribers as `complete()`.
- `destroy(error)` called from inside an observer callback was ignored: `#emit` overwrote the aborted state, parsing continued to the end and the parser reported success with a complete `root`. Re-entrant `write()` and `end()` now throw instead of corrupting parser state; `destroy()` remains the way to stop early.
- `JsonStream` re-emitted `'value'` on every write after the root had closed.
- A retained string value kept the entire write buffer alive: V8 makes a slice of 13 characters or more a `SlicedString` pointing at its parent, so one short `id` held on to megabytes of surrounding JSON.

### Performance

Measured against 1.1.4 through the same `JsonStream` API, same payloads, 64 KB
chunks, best of five runs on Node 26.8.2 and Bun 1.4.2 (Apple silicon).

| | Node 1.1.4 | Node 2.0.0 | Bun 1.1.4 | Bun 2.0.0 |
|---|---|---|---|---|
| wide object (1.1 MB) | 10.9 MB/s | 88.8 MB/s | 10.7 MB/s | 128.5 MB/s |
| array of objects (2.5 MB) | 11.2 MB/s | 109.4 MB/s | 9.9 MB/s | 93.7 MB/s |
| two 2 MB strings | 6.9 MB/s | 28140 MB/s | 20.7 MB/s | 9190 MB/s |

The string row is scan-bound: a long string is located with `indexOf` and built
without touching each character, so its throughput depends on the payload far
more than the other two.

Parsing no longer suspends per value; it runs to the end of each `write()` over an explicit stack.

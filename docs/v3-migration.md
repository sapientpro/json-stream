# Migration from 2.x

The [3.0 usage guide](v3.md) covers the new API; the [reference](v3-reference.md) lists options and defaults.

| 2.x | 3.0 |
| --- | --- |
| `observe(path).subscribe(({value, path}) => ...)` | `onValue(path, (value, path) => ...)` |
| `chunks(path).subscribe(fragment => ...)` | `onString(path, (fragment, path) => ...)` |
| `value(path)` | `getValue(path)` |
| `stream(path)` | `stringStream(path)` |
| bare/dotted strings such as `items.id` | JSONPath `$.items.id`, or typed selector arrays |
| `root` / `retainRoot` | `getValue()` or `onValue('$', callback)` |
| numeric-string selectors accepted on arrays | numeric indexes require `[0]`, not `['0']` |
| late registration with root retention/replay | register before first write; no replay |
| root completion used as `finished` | `rootReady` for availability; `finished` after `end()` |
| permissive syntax in some JSON cases | strict separators, escaping, numbers and trailing input |

`collectJson` and `maxDepth` remain options. `start` moves to an optional input manager; the core accepts only JSON/JSON5. `collectJson`
retains all decoded input and therefore defeats bounded input-memory usage.
`maxDepth` defaults to 1000 and accepts nonnegative safe integers or Infinity.
A core parser consumes one document. Optional managers below consume multiple documents.


There is no `root` getter or `retainRoot` option; passing the removed option throws `TypeError`. Subscribe to `$` before writing to build a complete result.

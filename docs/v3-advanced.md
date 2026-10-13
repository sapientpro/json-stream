# Advanced parser usage

Ordinary value, string and transport recipes are in the [usage guide](v3.md).
Use these features when managing document boundaries or repeatedly parsing the
same subscription layout.

## Document boundaries

`write(text)` returns a count of unconsumed UTF-16 units from that call's input.
With the default `strictEnd: true`, it consumes the whole chunk or throws: after
one complete value, only the dialect's permitted trailing whitespace/comments
are allowed, including later writes. Plain JSON allows only its four whitespace
characters. JSON5 also permits comments. `end(text?)` accepts an optional final
text chunk, validates EOF, completes consumers, and returns that final chunk's
unconsumed count (zero in strict mode).

Use `strictEnd: false` when a manager owns the suffix:

```ts
const parser = new JsonParser({strictEnd: false});
parser.onValue('$', value => console.log(value));
const input = '{"id":1} next';
const unread = parser.write(input);
if (parser.rootReady) {
  const tail = input.slice(input.length - unread); // ' next'
  parser.reset(); // preserve subscriptions for another document
  // The manager decides how to use tail.
}
```

This mode stops at the first complete value without validating or retaining the
suffix. Subsequent `write()` calls, including empty writes, require `reset()`.
`rootReady` identifies that boundary even when the unread count is zero;
`finished` still means successful EOF validation by `end()`. Partial tokens are
accepted into parser state and return zero. A number such as `123` at a chunk end
may still continue as `123.5`; a terminator or EOF is needed before commitment.
Malformed/incomplete tokens still fail. With `collectJson`, only the consumed
prefix is collected in non-strict mode. Streams normally use strict mode;
managers that handle returned suffixes synchronously use non-strict mode.

JSONL managers always validate each whole physical record. Prefix managers always
stop at a document boundary. Their boundary policy overrides a supplied
`strictEnd` option.

## Reusing a core parser

`reset()` validates the current document exactly as EOF would, then clears its
string/number/comment state and per-document input while preserving active
subscriptions and cached selector transitions. It does not emit consumer completion.
Use it **instead of `end()` at intermediate document boundaries**; call `end()`
only for the final document. An incomplete or invalid document fails rather than
being discarded. A closed/failed parser cannot reset. Registration stays frozen
and the core remains string-only across resets. Canceled consumers stay canceled.
`getValue` remains a first-match promise, not a promise reused for every record.

```ts
const parser = new JsonParser();
parser.onValue('$', value => console.log(value));
parser.write('1');
parser.reset(); // validates and emits 1, keeps the subscription
parser.write('{"second":true}');
parser.end();  // emits second value, completes the input
```

`rootReady`, `finished` and collected `json` are cleared by reset.
Previously delivered objects and owned paths remain valid. JSONL and prefix
managers call reset internally; their consumer completion still means whole-input
EOF.

## Reusing a subscription plan

For many independent documents with the same subscriptions, compile their layout
once and bind it to each fresh parser:

```ts
import {compileSelectors, JsonParser} from '@sapientpro/json-stream';

const plan = compileSelectors([
  '$.id', // complete values by default
  {path: '$.choices[*].delta.content', kind: 'string'},
]);

function readReply(chunks: Iterable<string>) {
  const parser = new JsonParser();
  const [ids, fragments] = plan.bind(parser, [
    (id, path) => console.log(id, path),
    {next: (text, path) => console.log(text, path), end: path => console.log(path)},
  ]);
  for (const chunk of chunks) parser.write(chunk);
  parser.end();
  // ids.unsubscribe() and fragments.unsubscribe() are also safe before/during parsing.
}
```

`compileSelectors(definitions)` accepts JSONPath strings, typed selector arrays,
or `{path, kind: 'value' | 'string'}` entries. Input paths are snapshotted. The
returned plan has `bind(parser, callbacks)`, which requires one function or observer
per definition, in the same order, and returns one cancellation handle per binding.
Callback values are typed as `any`; annotate them when the expected shape is known.

A plan owns selector topology and prepared transition descriptors, never consumer
callbacks or document data. Binding creates independent channels and contexts for
each parser; parsers sharing a plan can run concurrently. Cancellation, callback
errors, completion, compact memory mode, `reset()` and Web/Node adapters retain
the ordinary parser semantics. All binding must happen before the first write.

Fresh parsers gain the most. Additional ordinary registrations, including
`getValue()` or `stringStream()`, invalidate prepared transitions before parsing;
binding into a parser with existing consumers also uses ordinary lazy transitions.
Existing consumers keep working. Large selector graphs fall back to lazy
transitions without rejecting valid selectors. Root-only subscriptions use the
existing builder. There is no global query cache.

Compilation has a one-time cost: reuse a plan across requests instead of compiling
one per document. The main benefit is setup and transitions for short documents;
large root values are dominated by parsing/building. JSONL and prefix managers
already reuse their parser through `reset()`; plans bind to core JSON/JSON5 parsers,
not record managers. `compileJsonPath()` remains the lighter option for reusing
only a validated path.

## Compact memory mode

`strictEnd: false` can be combined with `memoryMode: 'compact'`. The compact
mode preserves unread counts and reset semantics. The memory policy copies only
short scalar results/fragments after large input writes; it does not copy tails
or recursively detach retained container values.

See [copying policy and limitations](v3-copying.md).

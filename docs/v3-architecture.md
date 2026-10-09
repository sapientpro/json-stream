# Candidate architecture

`src/v3/core.ts` owns builders, retention, selector contexts, concrete paths,
consumer lifecycle. It accepts strings only. `json-scanner.ts` and
`json5-scanner.ts` are separate hot loops with the same structural state contract.
They call core methods directly; no token objects, intermediate queues or generic
format check occur on each character.

A scanner identifies the next value and advances its selector context once at
value entry. Frames store the parent context, retained container if needed, array
index and object key. Exact string properties and numeric indexes have separate
edges. Wildcards share cached transitions; unknown input keys reuse a fallback
rather than enlarging the cache. Callback channels are bound to one parser and
can be canceled. All registration happens before input so cached transitions
never have to absorb new subscriptions.

Selected object/array values are built completely. Ancestor retention propagates
to children. A root consumer therefore requires the whole tree. String-only
consumers accumulate fragments; a value consumer (including a $ subscription) additionally
requires the complete string. Fragment cancellation removes the active sink and
preserves any already accumulated pieces needed by retained values. Path arrays
are concrete owned snapshots, not mutable parser stack views.

When there are no reachable consumers at the first write, the core selects simpler
open/emit methods once. On V8 it also applies to value-only root subscriptions; on Bun those use the
ordinary builder, which is faster in paired measurements. The no-consumer path
validates structure without materializing unrequested containers or values.
A V8 root-value subscription uses the same simple builder with full retention,
without child selector transitions or concrete paths. This selection stays fixed for
the document. It applies to both dialects without a released 2.x fallback.

Web and Node wrappers own incremental UTF-8 decoding and input pacing.
The synchronous `createDecodedInput` adapter shares the same decoding lifecycle: it
flushes at EOF, releases the decoder after failure/cancellation, and rejects mixed
text/byte writes before consuming them. JSONL and prefix managers retain their own
transport policies, including strict JSONL UTF-8 and BOM rejection. String output
streams own their queues and unsubscribe on cancellation/overflow. No asynchronous
callback work suspends the scanner inside a write. A future resumable output API
would need an explicit suspension contract rather than implicitly awaiting user
callbacks.

A generated implementation which inlined the common core into private fields was
measured and removed: ordinary Node scalar workloads lost roughly 4–6%, and Bun
root construction lost about 12% compared with inheritance. This candidate shares
source and runtime methods instead. Current selector plans/bindings are per-parser;
reusable immutable compiled plans are a separate potential optimization, especially
for parsing many independent documents. `compileJsonPath()` returns an immutable
path, not a reusable mutable execution context.

JSON5 adds its grammar before further architecture decisions: comments, single
quotes, identifier keys, trailing commas, additional whitespace and escapes,
hexadecimal/nonfinite/signed/leading-or-trailing-dot numbers. Plain JSON keeps
strict separators, escapes, numbers and trailers. EOF is validated separately from
root commitment. A callback can see a completed value before a later syntax error.

JSONL and prefixed-document managers share record consumer bindings and reuse one
parser via `reset()`, preserving subscriptions and bounded selector transition caches. JSONL splits at LF and forwards partial lines immediately.
Strict input keeps the ordinary write method. Non-strict input selects a managed
write method once at construction, so normal writes have no per-chunk mode checks.

The prefix manager uses `strictEnd: false`: scanning stops at END and returns
the number of unconsumed UTF-16 units; the remaining input goes back to marker search.
Prefix seeking is removed from both core scanners. The prefix manager passes a
private cursor into the original chunk instead of repeatedly slicing the remaining input;
Bun copied those tails and became dramatically slower at 64KiB. Reusable plans
across independent parser instances remain a potential follow-up. Slices,
filters, unions and negative indexes are rejected in this
candidate. Recursive descent is implemented in subscription contexts: the Rest
state persists at each depth while its suffix advances independently. Exact suffix
edges are included in transition caches, with separate numeric indexes and property
names. Converging recursive routes deduplicate subscription nodes before dispatch;
terminal-only Rest keeps the existing transition path. Neither scanner changes.

## Native string validation

On known V8 runtimes, strict JSON can use `JSON.stringify` solely to detect escapes in whole raw input segments of 8–64 Ki UTF-16 units starting with ASCII. A changed serialized length falls back to the control-character check, preserving accepted lone surrogates. This never parses or buffers a whole document. Tiny, sliced, larger and Unicode-first segments use the regular control check. Bun and unknown browser engines use the portable scanner.

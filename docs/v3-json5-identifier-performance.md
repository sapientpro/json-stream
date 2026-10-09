# JSON5 repeated identifiers

Baseline: main `2da504d`, including the numeric-state and strict-JSON key optimizations. Tooling PR #32 changes no parser code and has the same parser baseline. This patch only optimizes JSON5 unquoted identifiers; strict JSON and quoted-key scanning keep their existing algorithms.

The decoder memoizes complete, already validated raw tokens. It does not skip tokenization or accept an identifier prefix. Names containing escapes are still validated character by character on a miss. The module shares a bounded 64-slot memo across parser instances; names longer than 64 UTF-16 units bypass it. A slot uses the first code unit, so collisions replace entries. Sixteen misses before 64 cache hits trigger 4,096 uncached calls. Hits clear the miss window only after the 64th hit, so a mix of unique outer keys and repeated inner keys can also disable memo updates. Reset preserves the shared memo; correctness does not depend on its contents.

## Input retention

Stored tokens use independent character copies. Concatenating a prefix and slicing it away was insufficient to detach these strings on both measured runtimes. The JSON5 token-boundary RegExp can also retain its last input buffer; document final validation replaces that subject with one space. Cancellation and syntax errors perform the same cleanup when final validation has not completed. The next token scan always sets its own `lastIndex`. No GC calls are added to the parser.

A separate retained-heap probe parses twelve 8 MiB ignored strings with short ordinary/escaped identifiers, then resets and keeps twelve parsers alive. It leaves allocation stack frames before diagnostic collection. For 96 MiB of total input:

| Runtime | Baseline residual heap | Patch residual heap |
|---|---:|---:|
| Node 26.10.0 | 0.112 MiB | 0.113 MiB |
| Bun 1.4.2 | 0.186 MiB | 0.189 MiB |

This measures residual live heap after reset, not peak memory. RSS includes allocator and runtime memory; it does not equal the number of retained input bytes. The rejected first memo prototype retained approximately 8 MiB on Node and 96 MiB on Bun in this probe.

```sh
node --expose-gc scripts/verify-identifier-memory.mjs
bun scripts/verify-identifier-memory.mjs
```

Pass a separately built baseline ESM entry as the first argument to compare. A second argument chooses `reset` (default), `end`, `destroy` or `error`. Forced collection is confined to this optional memory diagnostic.

## Throughput protocol

Node 26.10.0 and Bun 1.4.2, Apple M4 Pro. Natural GC, serial fresh workers, three pairs alternating version order. Each worker prepares input and checks values/paths outside timing. Parser construction, registrations, decoding, writes, end and result consumption are timed. Seven samples of 64 documents follow 512 warmup documents for unquoted objects, IDs, unique and wide objects; quoted/LLM controls use 128 documents per sample. Throughput is decimal MB/s; the tables use the median of three worker medians, with pair ranges reported separately. Optional process CPU time includes user/system work and GC threads; it is not main-thread utilization.

`--same-path` copies each compiled v3 module directory to one temporary canonical location between workers. Workers complete synchronously before files are replaced. Original source module URLs remain in result metadata. The temporary directory is removed on success and preserved if a worker fails. This controls module URL variation; it does not establish that paths caused previous timing differences.

The objects fixture has 8,000 items containing id, name, active, tags and score. Unquoted JSON5 adds a leading comment, removes quotes from its known property names and adds a trailing comma. Root retains the complete result; IDs consumes each concrete `items[*].id` path. Quoted JSON5 uses the JSON fixture through the JSON5 frontend.

LLM controls stream independent string fragments and consume owned paths. The token input uses code-point lengths `1,3,8,2,16,4,32,5,48,7` before UTF-8 encoding; 128-byte input cuts include incomplete UTF-8 sequences. These controls are distinct from cumulative previews.

The unique fixture contains 8,000 single-property objects with distinct `keyN` identifiers. The wide fixture contains 16,000 distinct outer `keyN` properties, each holding an object with `id` and `text`. This interleaves misses with hits; clearing the miss count on every hit hid its cost in the first prototype.

## Measurements

### node

| Workload | Baseline MB/s | Patch MB/s | Change | Pair range |
|---|---:|---:|---:|---:|
| objects/root | 114.0 | 143.6 | +26.0% | +21.0…+29.2% |
| objects/ids | 113.6 | 142.6 | +25.5% | +25.5…+29.1% |
| unique identifiers/root | 43.0 | 43.2 | +0.4% | -3.6…+0.7% |
| wide object/root | 96.8 | 95.0 | -1.8% | -7.4…+4.9% |
| quoted-root | 153.4 | 157.8 | +2.9% | +0.2…+11.2% |
| json5-tokens | 81.5 | 81.3 | -0.3% | -0.8…+1.5% |
| json5-llm-128 | 189.1 | 187.1 | -1.1% | -1.1…-0.8% |
| strict-llm-128 | 182.9 | 183.8 | +0.5% | -1.1…+1.7% |

### bun

| Workload | Baseline MB/s | Patch MB/s | Change | Pair range |
|---|---:|---:|---:|---:|
| objects/root | 92.0 | 131.9 | +43.4% | +40.1…+46.7% |
| objects/ids | 100.4 | 128.8 | +28.3% | +22.4…+30.5% |
| unique identifiers/root | 95.2 | 97.1 | +1.9% | -4.0…+3.9% |
| wide object/root | 84.7 | 82.6 | -2.4% | -3.9…-0.5% |
| quoted-root | 139.6 | 136.3 | -2.3% | -6.1…+0.1% |
| json5-tokens | 113.2 | 114.8 | +1.4% | -1.3…+3.9% |
| json5-llm-128 | 254.4 | 254.2 | -0.1% | -1.1…+3.6% |
| strict-llm-128 | 281.6 | 280.3 | -0.5% | -4.2…-0.1% |

Bun wide-object confirmation: five pairs, 1,024 warmups, seven samples of 128 documents. Baseline 83.0 MB/s, patch 82.6 MB/s (-0.4%), pair range -4.0…+3.7%.

Repeated unquoted keys improve in every main pair. Unique identifiers cross zero; they are not a speedup claim. Short wide-object controls are negative; the longer Bun series crosses zero. Bun quoted-root also has a possible small cost. This remains a workload-specific tradeoff. Node JSON5 128-byte streaming shows approximately a 1% possible cost; token-sized and strict-JSON controls vary around zero. Do not treat small positive controls as proven speedups.

Node quoted-root measurements can occupy different natural-GC regimes on both versions. A diagnostic trace found approximately the same 11.33 GiB of allocation but much greater young-generation promotion and GC work in slow workers. The promotion/lifetime cause is not fully identified. These traces and older prototypes are separate diagnostic series, not combined with the tables. No claim of regression-free performance is made.

## Lifecycle method context

A `super._release()` method made V8 allocate an additional class context. `_run` grew from 3,175 to 3,191 bytecode bytes and changed module/context reads from depth zero to depth one despite an unchanged method body. The cleanup override directly invokes `ParserCore.prototype._release` with the parser receiver; the cast only permits TypeScript protected-member access. `_run` keeps the baseline 3,175-byte bytecode and context depth. This is a bytecode observation on the measured V8 version, not a claim that the extra context explains all throughput variation.

## Reproducing controls

Build the baseline separately, then build the patched checkout. Run Node and Bun sequentially:

```sh
node scripts/benchmark.mjs --engine node \
  --baseline /absolute/path/to/baseline/dist/esm/v3/index.js \
  --baseline-api callback --baseline-label 2da504d --same-path --cpu \
  --format json5 --syntax json5 --cases objects/root,objects/ids \
  --sizes 1024 --pairs 3 --warmups 512 --iterations 64 \
  --output /tmp/json5-identifiers-node.json
```

Use `--engine bun` for Bun. Quoted controls omit `--syntax json5` and use `--iterations 128`. Unique and wide controls use `--cases "unique identifiers/root,wide object/root"` with `--syntax json5`. For LLM byte controls, use `--cases llm/string --sizes 128`; token input replaces `--sizes` with `--chunk-unit codepoint --chunk-pattern 1,3,8,2,16,4,32,5,48,7`. Strict JSON controls use `--format json`. The normal benchmark does not require exposed GC.

## Validation

Build, 445 tests across 24 suites, and 22,400 JSON/JSON5 acceptance/output comparisons on each of Node and Bun pass. An additional 66,982 baseline comparisons per runtime cover valid/invalid keys, UTF-8/text cuts, selective callbacks, strings and reset using identical serialized fixtures.

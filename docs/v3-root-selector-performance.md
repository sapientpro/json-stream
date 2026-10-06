# Root selector setup

Baseline: merged PR26, `7b3a811`. The `$` selector now returns a shared frozen
empty path before allocating the general JSONPath parser's helper closures.
This also avoids freezing a new empty array on each root subscription.
Other selectors retain the same compiler. Parser scanning, callback dispatch,
retention and JSON/JSON5 grammar are unchanged. This targets repeated short
documents; it is not a large-document scanning optimization.

## Setup confirmation across runtimes

Serial fresh processes, three alternating pairs, 20,000 warmups, seven samples
×100,000 parses. Text JSON input; parser creation, `$` registration, synchronous
callback consumption, write and end included. Deltas compare median process
throughputs; pair ranges expose variability. Values below are **million complete
parses/second**, not MB/s. Fixtures: `123`, `{}`, and
`{"id":1,"text":"😀","active":true}`. The production variant preserves frozen
output; preliminary mutable-path prototypes were discarded before validation.

| Runtime | Fixture | main M parses/s | candidate M parses/s | Δ | pair range |
|---|---|---:|---:|---:|---:|
| node26 | scalar | 1.780 | 1.863 | +4.7% | +3.0…+7.0% |
| node26 | empty | 1.792 | 1.885 | +5.2% | +2.4…+6.4% |
| node26 | small | 1.290 | 1.325 | +2.7% | +2.2…+2.7% |
| node24 | scalar | 1.729 | 1.807 | +4.5% | +3.0…+6.3% |
| node24 | empty | 1.761 | 1.804 | +2.4% | +0.9…+6.2% |
| node24 | small | 1.250 | 1.301 | +4.1% | +3.6…+4.9% |
| node22 | scalar | 1.677 | 1.713 | +2.1% | +2.1…+3.7% |
| node22 | empty | 1.707 | 1.741 | +2.0% | +0.6…+2.4% |
| node22 | small | 1.228 | 1.251 | +1.8% | +0.6…+1.8% |
| bun | scalar | 2.695 | 3.149 | +16.9% | +14.4…+21.0% |
| bun | empty | 3.165 | 3.723 | +17.6% | +13.4…+22.2% |
| bun | small | 2.015 | 2.334 | +15.8% | +10.9…+15.9% |

## Large-document controls

Node26/Bun, text JSON, three alternating fresh-process pairs,160 warmups,
7×32 parses. Integer arrays and LLM chunks64KiB; objects and selectedIDs1KiB.
These controls do not establish meaningful large-document gains. In particular,
wide pair ranges include negative samples; they do not prove zero regression.

| Runtime | Workload | main MB/s | candidate MB/s | Δ | pair range |
|---|---|---:|---:|---:|---:|
|node|integers/root|139.1|140.8|+1.2%|-1.2…+16.3%|
|node|objects/root|134.5|134.9|+0.3%|-1.7…+1.1%|
|node|objects/ids|127.7|128.2|+0.4%|-1.9…+0.9%|
|node|llm/string|797.6|805.1|+0.9%|-1.4…+0.9%|
|bun|integers/root|304.1|319.1|+4.9%|-3.8…+16.5%|
|bun|objects/root|186.6|190.3|+2.0%|+1.1…+3.9%|
|bun|objects/ids|188.0|191.1|+1.6%|-5.9…+9.8%|
|bun|llm/string|360.4|362.9|+0.7%|-2.6…+8.5%|

## Reproduce with the public benchmark

The public benchmark includes `scalar/root` (`123`), `empty/root` (`{}`), and
`small/root` (two nested item objects; distinct from the setup fixture above).
Keep a built baseline checkout at `7b3a811`, then build this checkout. Run workers
serially on an otherwise idle machine:

```sh
node scripts/v3/benchmark.mjs --engine node --baseline /path/to/baseline/dist/esm/v3/index.js --baseline-api callback --baseline-label main --format json --cases scalar/root,empty/root,small/root --sizes 65536 --input text --pairs 3 --warmups 20000 --iterations 100000 --output /tmp/root-setup-node.json
```

For Bun use `--engine bun`; for the JSON5 byte-input control use
`--format json5 --input bytes`. JSON5 controls consume the same valid JSON
fixtures, which are also valid JSON5. `--runtime` selects Node22 or Node24.

## Public benchmark confirmation

Same20,000 warmups,7×100,000 parses,3pairs; shipped benchmark worker with
fixture value checks, final built module,Node26/Bun. Million parses/second.

| Runtime | Format/input | Workload | main M parses/s | candidate M parses/s | Δ | pair range |
|---|---|---|---:|---:|---:|---:|
| node | json/text | scalar/root | 1.595 | 1.681 | +5.4% | +3.6…+6.3% |
| node | json/text | empty/root | 1.681 | 1.765 | +5.0% | +3.1…+5.0% |
| node | json/text | small/root | 0.979 | 1.008 | +3.0% | +2.5…+3.4% |
| node | json5/bytes | scalar/root | 1.226 | 1.259 | +2.7% | +1.3…+3.2% |
| node | json5/bytes | empty/root | 1.305 | 1.328 | +1.8% | +1.4…+1.9% |
| node | json5/bytes | small/root | 0.864 | 0.868 | +0.5% | +0.3…+1.4% |
| bun | json/text | scalar/root | 2.541 | 2.916 | +14.8% | +13.4…+19.1% |
| bun | json/text | empty/root | 3.055 | 3.565 | +16.7% | +15.1…+19.9% |
| bun | json/text | small/root | 1.543 | 1.703 | +10.4% | +5.7…+10.6% |
| bun | json5/bytes | scalar/root | 1.957 | 2.128 | +8.8% | +8.4…+11.1% |
| bun | json5/bytes | empty/root | 2.328 | 2.651 | +13.9% | +12.4…+15.4% |
| bun | json5/bytes | small/root | 1.136 | 1.192 | +5.0% | +4.6…+6.1% |

## Validation and rejected alternatives

Build and all402 tests/22 suites pass, including the existing frozen JSONPath
output test and invalid-selector checks. Array `push()` versus indexed assignment
was also tested separately: the apparent short-screen15–19% Node integer gain
did not survive longer warmup and object/Bun controls. No array-building change
is included. Raw prototypes remain in ignored local notes.

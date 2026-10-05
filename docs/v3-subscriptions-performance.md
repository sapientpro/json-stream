# Subscription-driven retention and unified JSONPath

Compared with [PR #19](https://github.com/sapientpro/json-stream/pull/19), commit `a95801e9`. The baseline uses implicit root retention for full-result workloads; the candidate requests the equivalent result through `onValue('$', ...)`. Selective and fragment-only workloads do not request a root on either side. This is an API/memory change, not a claimed throughput optimization.

Text chunk sizes are UTF-16 code units; byte chunk sizes are bytes. Throughput always uses encoded fixture bytes. JSONPath strings compile once at registration. The harness uses equivalent typed selector arrays on both sides for parsing controls.

Build the baseline in a separate checkout and pass its ESM `dist/esm/v3/index.js` to the candidate's harness. For example:

```sh
node scripts/v3/benchmark.mjs --baseline /absolute/baseline/dist/esm/v3/index.js --baseline-api callback --baseline-label PR19 --cases llm/string,escapes/string --sizes 32,128,1024 --pairs 3 --warmups 160 --iterations 32 --output /tmp/subscriptions-node.json
```

Use `--engine bun` for Bun, `--input text` for decoded text, or `--cases integers/root,objects/root,objects/ids,wide\ object/root --sizes 1024,65536` for full-result and selection controls.

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

## node

`v26.10.0`

{"repetitions":3,"warmups":160,"iterations":32,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR19 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| escapes/string (bytes) | 32 | 59.0 | 60.4 | 2.3% | -0.4…2.3% |
| llm/string (bytes) | 32 | 81.4 | 81.3 | -0.1% | -1.3…2.4% |
| escapes/string (bytes) | 128 | 94.0 | 92.8 | -1.2% | -4.5…0.8% |
| llm/string (bytes) | 128 | 166.5 | 168.0 | 0.9% | -1.0…1.6% |
| escapes/string (bytes) | 1024 | 141.0 | 139.6 | -1.0% | -1.2…0.1% |
| llm/string (bytes) | 1024 | 253.8 | 259.3 | 2.2% | -0.3…2.5% |

## bun

`1.4.2`

{"repetitions":3,"warmups":160,"iterations":32,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR19 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| escapes/string (bytes) | 32 | 123.1 | 120.2 | -2.4% | -2.8…-1.7% |
| llm/string (bytes) | 32 | 161.0 | 171.9 | 6.8% | 1.7…6.8% |
| escapes/string (bytes) | 128 | 159.7 | 159.8 | 0.0% | -0.8…1.6% |
| llm/string (bytes) | 128 | 272.6 | 266.0 | -2.4% | -3.2…7.5% |
| escapes/string (bytes) | 1024 | 193.4 | 191.5 | -1.0% | -6.5…-1.0% |
| llm/string (bytes) | 1024 | 362.0 | 355.7 | -1.7% | -3.2…1.9% |

## node

`v26.10.0`

{"repetitions":3,"warmups":160,"iterations":32,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR19 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| escapes/string (text) | 32 | 96.9 | 96.4 | -0.5% | -1.1…0.8% |
| llm/string (text) | 32 | 174.6 | 172.9 | -1.0% | -1.0…1.0% |
| escapes/string (text) | 128 | 111.5 | 112.9 | 1.3% | 0.8…1.8% |
| llm/string (text) | 128 | 226.6 | 210.9 | -6.9% | -44.7…-1.0% |
| escapes/string (text) | 1024 | 149.0 | 145.3 | -2.5% | -17.8…0.6% |
| llm/string (text) | 1024 | 274.7 | 276.5 | 0.7% | -33.5…2.7% |

## bun

`1.4.2`

{"repetitions":3,"warmups":160,"iterations":32,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR19 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| escapes/string (text) | 32 | 159.6 | 158.2 | -0.9% | -2.7…1.0% |
| llm/string (text) | 32 | 292.0 | 290.0 | -0.7% | -1.8…7.6% |
| escapes/string (text) | 128 | 205.1 | 206.3 | 0.6% | 0.1…3.6% |
| llm/string (text) | 128 | 428.8 | 407.2 | -5.0% | -8.9…-2.8% |
| escapes/string (text) | 1024 | 223.5 | 219.8 | -1.7% | -2.3…2.8% |
| llm/string (text) | 1024 | 505.7 | 503.5 | -0.4% | -4.3…0.1% |

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

## node

`v26.10.0`

{"repetitions":3,"warmups":160,"iterations":32,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR19 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| integers/root (bytes) | 1024 | 129.7 | 134.5 | 3.7% | -8.0…6.0% |
| objects/root (bytes) | 1024 | 101.6 | 96.2 | -5.3% | -12.9…-4.0% |
| objects/ids (bytes) | 1024 | 105.1 | 99.2 | -5.7% | -6.6…-1.1% |
| wide object/root (bytes) | 1024 | 85.7 | 83.1 | -3.1% | -6.9…-1.7% |
| integers/root (bytes) | 65536 | 114.7 | 118.1 | 3.0% | -14.5…11.9% |
| objects/root (bytes) | 65536 | 95.0 | 96.4 | 1.6% | -9.4…1.6% |
| objects/ids (bytes) | 65536 | 93.6 | 98.8 | 5.5% | 3.1…6.7% |
| wide object/root (bytes) | 65536 | 79.6 | 75.5 | -5.2% | -5.8…-2.6% |

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

## bun

`1.4.2`

{"repetitions":3,"warmups":160,"iterations":32,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR19 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| integers/root (bytes) | 1024 | 237.5 | 213.9 | -9.9% | -19.2…1.6% |
| objects/root (bytes) | 1024 | 91.9 | 107.4 | 16.8% | 9.4…19.3% |
| objects/ids (bytes) | 1024 | 109.6 | 105.8 | -3.5% | -5.2…9.8% |
| wide object/root (bytes) | 1024 | 68.7 | 76.7 | 11.7% | 11.7…15.7% |
| integers/root (bytes) | 65536 | 216.0 | 216.1 | 0.1% | -18.8…5.6% |
| objects/root (bytes) | 65536 | 100.3 | 110.4 | 10.1% | 1.5…17.1% |
| objects/ids (bytes) | 65536 | 122.2 | 117.0 | -4.2% | -4.2…-0.9% |
| wide object/root (bytes) | 65536 | 73.9 | 76.7 | 3.7% | 3.7…10.3% |

## Repeated text-input control

The initial Node 128-unit LLM run contained one −44.7% process pair. Five fresh alternating pairs with 320 warmups and 64 iterations per sample did not reproduce that magnitude: Node median 166.9 → 169.6 MB/s (+1.6%, pair range −5.0…+12.2%). Bun repeat median 239.4 → 214.5 MB/s (−10.4%, pair range −10.4…+8.9%). Initial Bun median was −5.0%. Text-input throughput remains variable; these results do not establish performance parity.

A subsequent five-pair Bun repeat, while the user confirmed heavy CPU load,
reversed the sign to +8.8% (pair range −9.6…+28.3%). A process snapshot showed
CLion and multiple compiler workers competing for CPU. This does not prove a
speedup or invalidate every earlier sample; the 128-unit text regression remains
unconfirmed pending an unloaded repeat. New reports include
[CPU scheduling diagnostics](v3-performance.md#cpu-scheduling-diagnostics).

Object/selection regressions up to roughly 6% on Node and 4% on Bun remain visible in these controls. LLM byte input stayed within −2.4…+6.8% across the measured cases.

## Rejected root-only shortcut

Using the unobserved builder for every Bun root subscription improved the 64-KiB integer array by 16%, but regressed objects by 8.2% and wide objects by 12.6%. The shortcut was removed. A narrower scalar-array optimization remains a follow-up, with mixed/nested containers and string-streaming controls required.

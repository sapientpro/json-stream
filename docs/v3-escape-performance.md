# Batched escape decoding experiment

Follow-up to the v3 architecture PR. Strict JSON can decode a run of complete
escapes in a dedicated loop, reducing repeated outer state dispatch and parser-field
writes. The existing STR/ESC/UESC paths still handle incomplete escapes, quotes,
controls and EOF. Fragment boundaries, surrogate protection and cancellation remain
in the core; there is no whole-document native parse or token intermediate stream.

Enabled only on known V8 runtimes after at least 64 accumulated decoded UTF-16 units
and with at least 256 source units remaining. This prevents a new result allocation
for each short escaped string. Bun and unknown engines retain the old decoder.

Comparison against PR17 (commit 0e2b7c45a7bc37d7bfd660b9a4c4a0cc3754cc9e).
Serial alternating fresh processes, bytes 1 KiB/64 KiB, setup/paths consumed, output
checked; Node 26 three pairs/160 warmups/7×16, Bun two pairs/120/7×16. Short escaped
strings were added explicitly as a guard workload.

Reproduce with a built PR17 checkout:

```sh
node scripts/v3/benchmark.mjs --engine node --baseline /path/to/pr17/dist/esm/v3/index.js --baseline-api callback --baseline-label PR17 --pairs 3 --warmups 160 --cases 'escapes/string,objects/ids,short strings/scalar,short escaped strings/scalar,unicode/string,long string/root'
```

Main target: Node 26 escaped fragments 112.6→127.9 MB/s (+13.6%) at 1 KiB and
102.3→160.4 (+56.8%) at 64 KiB. Short escaped inputs around −1%; this is not a blanket
speedup. Broad screen showed Node long ASCII 64 KiB −4.2% and Bun IDs 1 KiB −3.6%;
follow-up confirmations below expose mixed pair results. Keep these tradeoffs
visible and investigate long-string/JIT/allocation sensitivity separately.

### Throughput comparison

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

### Node

`v26.10.0`

{"repetitions":3,"warmups":160,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR17 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| short strings/scalar (bytes) | 1024 | 125.1 | 126.4 | 1.0% | -1.3…1.4% |
| short escaped strings/scalar (bytes) | 1024 | 130.7 | 129.0 | -1.3% | -1.7…0.8% |
| objects/ids (bytes) | 1024 | 124.0 | 122.2 | -1.4% | -1.5…-0.9% |
| unicode/string (bytes) | 1024 | 579.5 | 579.6 | 0.0% | -2.2…1.3% |
| escapes/string (bytes) | 1024 | 112.6 | 127.9 | 13.6% | 13.6…14.4% |
| long string/root (bytes) | 1024 | 1449.3 | 1468.3 | 1.3% | -2.8…2.3% |
| short strings/scalar (bytes) | 65536 | 113.7 | 114.9 | 1.1% | -1.8…2.8% |
| short escaped strings/scalar (bytes) | 65536 | 130.2 | 128.9 | -1.0% | -1.3…-0.2% |
| objects/ids (bytes) | 65536 | 103.0 | 103.3 | 0.3% | -2.2…1.1% |
| unicode/string (bytes) | 65536 | 1151.4 | 1168.5 | 1.5% | -2.2…1.9% |
| escapes/string (bytes) | 65536 | 102.3 | 160.4 | 56.8% | 50.7…61.5% |
| long string/root (bytes) | 65536 | 5152.9 | 4935.1 | -4.2% | -6.5…-2.8% |

### Bun

`1.4.2`

{"repetitions":2,"warmups":120,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR17 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| short strings/scalar (bytes) | 1024 | 203.5 | 205.0 | 0.7% | -0.2…1.7% |
| short escaped strings/scalar (bytes) | 1024 | 236.3 | 238.7 | 1.0% | -0.0…2.1% |
| objects/ids (bytes) | 1024 | 169.6 | 163.4 | -3.6% | -3.9…-3.4% |
| unicode/string (bytes) | 1024 | 393.0 | 385.3 | -2.0% | -3.8…-0.2% |
| escapes/string (bytes) | 1024 | 183.4 | 181.5 | -1.0% | -1.5…-0.6% |
| long string/root (bytes) | 1024 | 5652.8 | 5521.6 | -2.3% | -4.2…-0.4% |
| short strings/scalar (bytes) | 65536 | 203.8 | 207.3 | 1.7% | 0.5…3.0% |
| short escaped strings/scalar (bytes) | 65536 | 248.0 | 245.9 | -0.8% | -1.4…-0.3% |
| objects/ids (bytes) | 65536 | 175.9 | 176.0 | 0.0% | -1.0…1.0% |
| unicode/string (bytes) | 65536 | 938.3 | 932.4 | -0.6% | -0.9…-0.4% |
| escapes/string (bytes) | 65536 | 123.9 | 123.8 | -0.1% | -1.0…0.8% |
| long string/root (bytes) | 65536 | 12609.1 | 12541.4 | -0.5% | -3.8…2.8% |

## Longer confirmation runs

### Throughput comparison

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

### Node

`v26.10.0`

{"repetitions":3,"warmups":160,"iterations":32,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR17 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| long string/root (bytes) | 65536 | 5107.4 | 4925.3 | -3.6% | -3.6…6.1% |

### Bun

`1.4.2`

{"repetitions":3,"warmups":160,"iterations":32,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR17 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| objects/ids (bytes) | 1024 | 170.5 | 175.4 | 2.9% | -3.0…12.9% |

## Node 24 supplementary escaped-fragment check

### Throughput comparison

All numbers are decimal MB/s. Alternating fresh processes, serial workers; parser construction and registration included. Callbacks read owned concrete paths. Values and fragments are checked against fixtures. Deltas compare the median throughput of process pairs, and pair ranges expose instability.

### Node

`v24.21.0`

{"repetitions":2,"warmups":120,"iterations":16,"samples":7,"setupIncluded":true,"ownedConcretePathsConsumed":true,"serialWorkers":true,"units":"decimal MB/s"}

| workload | chunk | PR17 MB/s | candidate MB/s | Δ | pair range |
|---|---:|---:|---:|---:|---:|
| escapes/string (bytes) | 1024 | 100.7 | 114.4 | 13.6% | 13.6…13.6% |
| escapes/string (bytes) | 65536 | 93.9 | 146.0 | 55.5% | 51.7…59.4% |

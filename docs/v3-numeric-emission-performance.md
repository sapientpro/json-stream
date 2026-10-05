# Numeric materialization during emission

Baseline: JSONPath subscriptions PR #20 (`b4ac4c2`). The strict JSON scanner on V8 passes validated decimal, exponent and long-integer source ranges into a specialized emitter. Conversion happens only when a value callback or retained parent needs the number. Small integer arithmetic and numeric grammar validation are unchanged. No token objects or per-number closures are introduced.

Bun and JSON5 retain eager conversion: enabling the specialized emitter there regressed exponent throughput by roughly 11% in Bun and JSON5 decimals by roughly 6% in Node. The emitter still preserves cancellation, destruction, root completion, selected paths and retained parent construction.

## Measurements

Decimal MB/s; UTF-8 input; alternating fresh processes, serial workers; construction and callback registration included. Node 26.10.0, three process pairs, 120 warmups, 32 measured iterations per sample, seven samples. The initial V8 prototype also enabled JSON5; the confirmation below checks the final strict-JSON-only implementation.

| workload | chunk bytes | #20 | V8 prototype | change |
|---|---:|---:|---:|---:|
| decimals/scalar | 1024 | 180.4 | 185.6 | +2.9% |
| exponents/scalar | 1024 | 137.1 | 140.5 | +2.5% |
| objects/root | 1024 | 147.9 | 148.5 | +0.4% |
| objects/ids | 1024 | 134.5 | 137.7 | +2.4% |
| objects/missing | 1024 | 168.9 | 174.7 | +3.5% |
| LLM/string | 1024 | 242.1 | 238.1 | −1.6% |
| decimals/scalar | 65536 | 181.9 | 184.8 | +1.6% |
| exponents/scalar | 65536 | 139.5 | 146.5 | +5.0% |
| objects/root | 65536 | 131.8 | 132.4 | +0.5% |
| objects/ids | 65536 | 124.8 | 129.6 | +3.8% |
| objects/missing | 65536 | 151.6 | 156.6 | +3.3% |
| LLM/string | 65536 | 342.8 | 339.0 | −1.1% |

The string control has a small regression despite unchanged string processing; scanner/core code shape can affect JIT compilation. It remains a follow-up target, not an omitted result. CPU/wall ratios are a scheduling diagnostic only; they do not correct throughput or measure CPU frequency.

## Final strict-only confirmation

Same Node protocol, 1024-byte chunks:

| workload | #20 MB/s | final MB/s | change | pair range |
|---|---:|---:|---:|---:|
| decimals/scalar | 183.3 | 191.0 | +4.2% | +1.6…+4.3% |
| exponents/scalar | 139.9 | 142.7 | +2.0% | −1.0…+6.0% |
| objects/ids | 138.0 | 141.4 | +2.4% | +2.1…+6.0% |
| LLM/string | 250.8 | 251.4 | +0.2% | −1.7…+2.9% |
| JSON5 decimals/scalar | 136.5 | 138.0 | +1.1% | −1.1…+5.1% |

The JSON5 confirmation uses the unchanged JSON5 conversion path. It removes the earlier material decimal regression; the remaining range does not establish a gain. LLM results also cross zero in the final confirmation, so the initial small slowdown is not a stable conclusion.

## Validation

353 tests across 19 suites cover requested/unrequested numeric syntax, all byte cuts through retained and selected values, negative zero, overflow, prototype keys, cancellation, destruction and reset. Differential verification covers 44,800 format cases on Node and Bun. Node, Bun and Deno smoke checks pass. JSON5 signed hexadecimal and nonfinite values retain their existing semantics.

# Copying facade throughput observations

The optional module is intended for sparse short outputs from large sources.
These are measured tradeoffs, not default-parser speed improvements. Existing
parser modules are byte-identical to alpha.2; only the opt-in facade adds copying.

Node 26.10.0 and Bun 1.4.2, strict JSON, three rotating fresh-process pairs,
128 warmups, seven samples of 32 parses each, natural GC, serial workers. Input
sizes are UTF-16 units for text and bytes for encoded input. Setup and callback
consumption are included. Both entries import exactly the same scanner files.
All 192 timing workers validate output content; selected-value and string cases
consume concrete paths. Each throughput
number is the median of three worker medians; paired ranges show all pairs.
Positive differences in a forwarding wrapper are observations, not a claim that
copying reduces parsing work. Results can vary with JIT and allocation behavior.

LLM 128 changes ranged from −2.4% to +2.9% across the four engine/input medians.
Dense short-scalar selections at 65536 units/write cost 56–59% in this run: copying
40,000 short values is expensive. This is why the module is opt-in and aimed at
sparse results, while ordinary small-chunk LLM parsing keeps the default API.

[Full timing samples and 32+64 memory diagnostics](../benchmarks/v3-copying-data/measurements.json).
[API, policy, memory findings and reproduction](v3-copying.md).

## Node, text

| Workload | Input units/write | Ordinary MB/s | Copying MB/s | Observed change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| short strings/scalar | 128 | 165.9 | 160.0 | -3.6% | -7.0…-2.3% |
| objects/root | 128 | 143.8 | 144.7 | +0.7% | -0.0…+1.9% |
| objects/items | 128 | 135.1 | 134.6 | -0.4% | -0.4…+0.1% |
| llm/string | 128 | 297.7 | 290.7 | -2.4% | -2.4…-1.5% |
| short strings/scalar | 65536 | 172.1 | 75.3 | -56.3% | -56.3…-54.9% |
| objects/root | 65536 | 191.4 | 188.9 | -1.3% | -3.9…+6.8% |
| objects/items | 65536 | 158.4 | 156.9 | -0.9% | -0.9…-0.2% |
| llm/string | 65536 | 881.5 | 870.7 | -1.2% | -2.3…-1.1% |

## Node, bytes

| Workload | Input units/write | Ordinary MB/s | Copying MB/s | Observed change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| short strings/scalar | 128 | 169.9 | 165.4 | -2.7% | -4.3…-1.6% |
| objects/root | 128 | 145.5 | 145.8 | +0.2% | -2.8…+1.8% |
| objects/items | 128 | 135.5 | 135.4 | -0.0% | -0.5…+0.3% |
| llm/string | 128 | 189.0 | 188.4 | -0.3% | -3.2…+1.2% |
| short strings/scalar | 65536 | 189.6 | 79.0 | -58.3% | -59.2…-56.8% |
| objects/root | 65536 | 193.8 | 197.3 | +1.8% | -2.6…+1.8% |
| objects/items | 65536 | 176.6 | 175.2 | -0.8% | -2.8…+1.1% |
| llm/string | 65536 | 638.7 | 626.9 | -1.8% | -5.9…+4.0% |

## Bun, text

| Workload | Input units/write | Ordinary MB/s | Copying MB/s | Observed change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| short strings/scalar | 128 | 208.7 | 203.9 | -2.3% | -7.1…+0.5% |
| objects/root | 128 | 195.7 | 200.4 | +2.4% | +1.2…+6.0% |
| objects/items | 128 | 170.8 | 168.5 | -1.3% | -1.9…+0.5% |
| llm/string | 128 | 474.9 | 488.7 | +2.9% | -2.2…+5.8% |
| short strings/scalar | 65536 | 217.8 | 89.3 | -59.0% | -60.8…-57.0% |
| objects/root | 65536 | 267.1 | 267.1 | -0.0% | -2.9…+4.6% |
| objects/items | 65536 | 221.4 | 220.3 | -0.5% | -4.7…+11.9% |
| llm/string | 65536 | 415.6 | 391.0 | -5.9% | -5.9…+5.1% |

## Bun, bytes

| Workload | Input units/write | Ordinary MB/s | Copying MB/s | Observed change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| short strings/scalar | 128 | 193.2 | 194.6 | +0.7% | -7.0…+2.3% |
| objects/root | 128 | 190.5 | 181.9 | -4.5% | -10.9…-1.4% |
| objects/items | 128 | 164.8 | 165.7 | +0.6% | -0.8…+8.1% |
| llm/string | 128 | 291.5 | 298.0 | +2.2% | -4.7…+6.0% |
| short strings/scalar | 65536 | 218.3 | 90.9 | -58.3% | -58.6…-57.0% |
| objects/root | 65536 | 274.4 | 278.1 | +1.4% | -1.9…+5.2% |
| objects/items | 65536 | 222.4 | 244.4 | +9.9% | +3.3…+13.5% |
| llm/string | 65536 | 390.7 | 401.3 | +2.7% | +2.7…+10.1% |

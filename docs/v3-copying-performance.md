# Compact memory-mode performance

Measured 2026-10-09 on Node 26.11.0 and Bun 1.4.2. These are historical controls for PR #38, merged as `3341785`; the feature is included in alpha.3. The baseline is the unchanged main40 core (main 16a3d15), before integrating the memory option. Fast is the new default; compact enables copying. JSON5 uses its own scanner in all variants.

## Final implementation: default and enabled costs

72 serial fresh-process workers, identical staged module paths, three alternating-order repetitions and seven samples per worker. Direct string input, natural GC, validated outputs and concrete paths. Parser construction and registration are included. Regular cases use 128 warmups and 32 iterations per sample; scalar uses 8,192 and 32,768. Throughput is decimal MB/s based on UTF-8 payload size. No decoder or stream scheduling is timed. This limited final matrix complements the broader prototype investigation; it is not a package comparison.

| Runtime | Format / workload / subscription | Chunk UTF-16 units | Baseline MB/s | Fast MB/s | Fast Δ | Compact MB/s | Compact Δ |
|---|---|---:|---:|---:|---:|---:|---:|
| node | json / llm / string | 32 | 232.6 | 224.7 | -3.4% | 221.2 | -4.9% |
| node | json5 / llm / string | 32 | 234.5 | 237.5 | +1.3% | 222.1 | -5.3% |
| node | json / short strings / scalar | 65536 | 166.8 | 164.0 | -1.7% | 95.2 | -42.9% |
| node | json / scalar / root | 128 | 5.8 | 5.7 | -1.2% | 5.7 | -2.1% |
| bun | json / llm / string | 32 | 363.6 | 368.0 | +1.2% | 349.6 | -3.8% |
| bun | json5 / llm / string | 32 | 320.3 | 329.6 | +2.9% | 307.2 | -4.1% |
| bun | json / short strings / scalar | 65536 | 207.9 | 218.5 | +5.1% | 114.4 | -44.9% |
| bun | json / scalar / root | 128 | 8.8 | 8.7 | -1.4% | 8.6 | -2.3% |

The default path has no per-write or per-emission memory-mode condition, but that does not make the integrated option free. **Node JSON LLM32 is −3.4% overall, with all three paired comparisons negative** (−3.4%, −6.0%, −1.2%). Node scalar setup is also negative in all pairs. Other rows have mixed paired directions; small positives should not be advertised as improvements. Bun dense strings have positive deltas in this series, but this change intentionally adds no parsing optimization to fast mode. Code layout, setup and JIT/GC variability remain possible influences; this experiment does not establish their cause.

Compact mode costs roughly 43–45% throughput on dense short scalar selections. LLM32 never reaches the large-input gate, so the enabled penalty there is forwarding/channel overhead, not useful copying. This remains a draft with normal-mode regressions explicitly visible.

[Final timing samples, CPU samples, protocol and JavaScript SHA-256 hashes](../benchmarks/v3-copying-data/memory-mode-final.json). CPU samples are supplementary; wall throughput remains the primary comparison.

## Retained memory

80 fresh-process diagnostics cover JSON/JSON5, text/decoded bytes, selective scalars/fragments, end/reset/destroy/error. Both modes are measured on end; compact additionally covers the other three lifecycle paths. Each retains four 128-unit Unicode outputs from four documents containing 8 MiB ignored text apiece. Parsers stay alive. Explicit collection is diagnostic-only.

| Runtime | Mode | Worst retained heap MiB | Worst external MiB |
|---|---|---:|---:|
| node | fast | 64.137 | 32.001 |
| node | compact | 0.152 | 0.000 |
| bun | fast | 64.195 | 64.134 |
| bun | compact | 0.203 | 0.138 |

These are separate maxima across probes, not quantities to add. Bun heap and external accounting can overlap. The ~64 MiB retention occurs in consumer-held slice cases; some Node scalar controls already release backing storage without copying. Results are retained live storage after collection, not peak RSS or a portable engine guarantee.

[All final memory diagnostic samples](../benchmarks/v3-copying-data/memory-mode-memory.json). No runtime parser or throughput benchmark forces GC.

## Reproduce and historical data

See [API, limits and commands](v3-copying.md). `scripts/benchmark-memory-mode.mjs --baseline /path/to/built/v3/index.js` reruns the three-variant final timing matrix serially, with default output under ignored notes. The memory diagnostic accepts `128 unicode compact` after the module path, and lifecycle `end`, `reset`, `destroy` or `error`.

[Historical facade measurements](v3-copying-facade-performance.md) describe the removed, unreleased `/copying` API and its split/join versus two-part-join experiment. Those measurements and immutable samples are preserved for provenance; they do not measure the current integrated option or prove its default entry unchanged.

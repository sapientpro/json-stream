# Post-alpha.3 review performance controls

Runtimes: Node v26.11.0, Bun 1.4.2.

Baseline: release 3.0.0-alpha.3; candidate: review fixes. Parser-only text input, same import path, fresh alternating workers, 120 warmups, seven samples of 16 documents, natural GC. Three pairs unless marked repeat (five). MB/s uses wall time; CPU deltas use median sample CPU time per document. These are correctness fixes, not an optimization claim.

| Run | Case | Chunk units | Before MB/s | After MB/s | Wall delta | CPU time delta |
|---|---|---:|---:|---:|---:|---:|
| bun-json-32 | llm/string | 32 | 358.1 | 359.4 | +0.4% | -0.8% |
| bun-json5-65536 | literals/scalar | 65536 | 139.0 | 139.9 | +0.6% | -0.2% |
| bun-json5-65536 | objects/root | 65536 | 172.6 | 178.0 | +3.2% | -4.9% |
| bun-json5-65536 | objects/ids | 65536 | 187.7 | 184.5 | -1.7% | +5.5% |
| bun-repeat | objects/root | 65536 | 265.2 | 266.9 | +0.7% | -1.6% |
| bun-repeat | objects/ids | 65536 | 244.5 | 272.9 | +11.6% | -10.7% |
| bun | decimals/scalar | 65536 | 287.7 | 281.2 | -2.2% | +1.8% |
| bun | objects/root | 65536 | 262.8 | 264.2 | +0.5% | -1.4% |
| bun | objects/ids | 65536 | 241.0 | 238.9 | -0.9% | +1.3% |
| bun | objects/missing | 65536 | 679.5 | 682.5 | +0.5% | -2.8% |
| bun | llm/string | 65536 | 391.7 | 404.2 | +3.2% | -4.6% |
| node-json-32 | llm/string | 32 | 228.6 | 228.2 | -0.2% | +0.9% |
| node-json5-65536 | literals/scalar | 65536 | 151.2 | 151.6 | +0.3% | -0.0% |
| node-json5-65536 | objects/root | 65536 | 157.0 | 155.1 | -1.2% | +4.6% |
| node-json5-65536 | objects/ids | 65536 | 155.1 | 153.8 | -0.9% | +0.3% |
| node | decimals/scalar | 65536 | 184.8 | 183.1 | -0.9% | +1.5% |
| node | objects/root | 65536 | 180.5 | 182.4 | +1.1% | -1.6% |
| node | objects/ids | 65536 | 174.9 | 171.1 | -2.2% | +1.8% |
| node | objects/missing | 65536 | 349.1 | 346.4 | -0.8% | +0.5% |
| node | llm/string | 65536 | 864.7 | 857.1 | -0.9% | -0.7% |

The initial Bun object regression did not repeat in the five-pair control. Bun object/ids varied substantially between fresh workers; do not interpret the positive repeat median as an improvement. LLM 32-unit input stayed essentially unchanged. Raw samples are retained locally in notes/analysis/post-alpha-review/.

Initial controls briefly overlapped verification commands; the five-pair Bun repeat ran separately. Treat small changes as inconclusive.

# Document boundary controls after compact memory mode

2026-10-09. Baseline main3341785 (merged PR38), candidate PR41 rebased on that main, including compact/managed write integration. No speedup claim. Both scanners and normal callback channels are unchanged.

84 serial fresh-process workers, natural GC, identical staged module path, three alternating-order pairs and seven samples. Direct text only; decoding and stream scheduling excluded. 128 warmups, 32 iterations per sample. Parser creation, subscription and owned paths are included. Node26.11.0 and Bun1.4.2. Each comparison uses the same memory mode in baseline and candidate.

| Runtime | Format / case / subscription | Chunk UTF-16 | Memory mode | Main38 MB/s | PR41 MB/s | Δ | Paired Δ |
|---|---|---:|---|---:|---:|---:|---|
| node | json / llm / string | 32 | fast | 224.0 | 226.5 | +1.1% | +4.7%, +3.2%, -1.0% |
| node | json5 / llm / string | 32 | fast | 230.3 | 230.6 | +0.1% | -0.4%, -1.0%, +0.8% |
| node | json / objects / items | 128 | fast | 126.9 | 124.6 | -1.8% | -2.0%, +5.4%, -2.3% |
| node | json / escapes / string | 65536 | fast | 477.8 | 478.6 | +0.2% | -1.4%, +0.6%, -0.1% |
| node | json / llm / string | 32 | compact | 214.9 | 214.8 | -0.0% | +1.7%, +2.3%, -0.0% |
| node | json / short strings / scalar | 65536 | compact | 96.2 | 92.8 | -3.5% | -2.7%, -2.8%, -3.5% |
| node | json / objects / root | 65536 | fast | 178.1 | 174.3 | -2.2% | -2.2%, +1.7%, -4.5% |
| bun | json / llm / string | 32 | fast | 344.2 | 338.0 | -1.8% | +4.4%, -1.8%, -7.3% |
| bun | json5 / llm / string | 32 | fast | 303.2 | 305.8 | +0.9% | -0.3%, +2.3%, +1.0% |
| bun | json / objects / items | 128 | fast | 178.3 | 167.3 | -6.2% | +1.5%, +1.0%, -13.2% |
| bun | json / escapes / string | 65536 | fast | 146.7 | 122.7 | -16.4% | -12.3%, -25.6%, -16.4% |
| bun | json / llm / string | 32 | compact | 323.2 | 317.9 | -1.6% | -0.7%, -3.0%, -0.9% |
| bun | json / short strings / scalar | 65536 | compact | 106.0 | 106.5 | +0.5% | +1.4%, -0.1%, -0.1% |
| bun | json / objects / root | 65536 | fast | 254.8 | 254.9 | +0.0% | -1.9%, +0.0%, +0.8% |

The Bun escape/string64Ki row is negative in all three pairs (−16.4% aggregate). This workload already showed multimodal behavior in the earlier PR41 controls; the new negative measurements remain visible and are not dismissed or replaced by the older positive median. Node compact dense strings are −3.5%, also all-negative. Bun items128 has one large negative pair; the aggregate −6.2% is not proof of a stable effect. Future profiling/longer controls remain TODOs; this correctness/API change makes no neutral-overhead guarantee.

[Complete timing and process CPU samples, protocol and JavaScript/worker hashes](../benchmarks/v3-document-boundaries-data/after-memory-mode.json). No forced GC in parser or throughput runs.

## Integration behavior

Compact input forwarding calls the method selected for strict/managed parsing and returns its unread-tail count. Managed cursor calls use that same compact entry. This preserves large-chunk tracking, prefix managers, original input offsets, reset and end(text?) without adding a mode condition to every ordinary write.

Validation: 508 tests; 9,884 fast/compact portable boundary checks each Node/Bun/Deno; 180 compact checks covering JSON/JSON5, all UTF-16 code units, JSONL/prefix, text/bytes and lifecycle; 22,400 ordinary differential checks per Node/Bun. Installed package type/runtime checks are recorded in the PR description.

## Reproduce

Build main3341785 separately, then build this branch. For example:

```sh
node scripts/benchmark.mjs --engine bun --baseline /path/to/main38/dist/esm/v3/index.js --baseline-api callback --baseline-label main38 --same-path --format json --input text --sizes 65536 --cases escapes/string --pairs 3 --warmups 128 --iterations 32 --cpu --output /tmp/boundaries-bun.json
# Add --memory-mode compact for compact-versus-compact controls.
```

Earlier pre-PR38 full matrices and rejected prototypes remain in excluded notes/analysis/document-boundaries. These final integration measurements take precedence for the rebased patch. No version or publication change.

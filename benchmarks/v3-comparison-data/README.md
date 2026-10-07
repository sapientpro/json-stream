# 3.0 alpha comparison samples

Measured 2026-10-08 (Europe/Kyiv), Apple M4 Pro. Parser source: PR35, e1d2d41.
Node 26.10.0; Bun 1.4.2; Deno 2.9.7 secondary subset.

The JSON files preserve each worker's seven wall/CPU samples, workload parameters,
correctness status and runtime versions. Each result is one JSON line within the
`results` array to keep the review diff manageable. These are normal JSON documents.
No forced GC. Worker setup/registration and decoding are included in timing.

See [the report](../../docs/v3-package-comparison.md) for tables and semantics.
The string column for @streamparser/json represents cumulative previews, not
independent fragments. json-web-streams string scenarios are unsupported, not failed.

For new runs use `npm run benchmark:competitors`, then optionally
`npm run benchmark:competitors:deno`. Generated outputs go to ignored
`benchmarks/results`; this directory is an immutable snapshot of this comparison.
To regenerate the report from this snapshot, copy these six JSON files to
`benchmarks/results`, then run:

```sh
node scripts/v3/competitors-report.mjs --engines node,bun,deno
```

The report uses the recorded parser source revision from each run, rather than
the checkout revision at report generation time.

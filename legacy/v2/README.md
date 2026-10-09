# Archived 2.x implementation

These sources, tests and tools preserve the last 2.x implementation used for
regression controls. Current package code lives in the repository's `src/`.
This directory is not exported or included in the npm package, and the default
build/test/benchmark commands use only current code.

Run from the repository root:

```sh
npm run build:legacy
npm run test:legacy -- --runInBand
node legacy/v2/scripts/smoke.mjs
npm run benchmark:legacy
npm run benchmark:legacy:regression
```

Legacy output is `legacy/v2/dist/{esm,cjs}`. Old reports remain under
`benchmarks/results/`; the legacy harness retains its original forced-GC policy.
The current parser's benchmarks use natural GC by default.

For a current-versus-legacy comparison, build both and pass the old ESM parser:

```sh
npm run build
npm run build:legacy
node scripts/benchmark.mjs --baseline legacy/v2/dist/esm/parser.js --baseline-api observable --baseline-label legacy-v2 --cases objects/ids --sizes 65536
```

The archived sources are a development control, not an independently versioned
or publishable package. For an immutable release baseline, build the requested
Git tag separately.

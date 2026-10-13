# Contributing

Work from a repository checkout and install development dependencies with `npm ci`.

## Checks

```sh
npm run build
npm test -- --runInBand
npm run check
npm run check:types
npm run test:formats
npm run benchmark
```

Biome provides `lint`, `format`, `format:check` and `check` across `src/`, `tests/`,
`scripts/` and the Jest configuration. CI enforces formatting and lint for all of
these files, including lint warnings. Lazy assignments, generic `any` defaults and checked array-index
assertions are allowed. Template-literal style is optional; inline `const enum`
codes and control characters in validation regexes are intentional. The JSON
scanner permits constant loop conditions because digit runs exit through explicit
bounds/character checks. Constructor-return shims in the compact-memory diagnostic
have local, documented exceptions.

`check:types` checks the packed package with the version locked in `package-lock.json`.
CodeQL scans TypeScript/JavaScript and GitHub Actions on pull requests, main pushes
and weekly. Dependabot checks npm dependencies and Actions weekly. Third-party
Actions are pinned to commit SHAs; official GitHub Actions use version tags.
See the [security policy](SECURITY.md) for private vulnerability reporting.

Benchmarks include setup and use natural GC, serial workers and correctness checks. See [current throughput and reproduction](docs/performance.md). Detailed reports and raw samples stay in ignored `notes/`.
The current implementation lives in `src/`, with tests in `tests/` and tools in
`scripts/`. The 2.x implementation remains in its Git release tags rather than
this working tree.
`npm run benchmark` runs the current parser on Node and Bun; `benchmark:v3`
remains a compatibility alias.


The public [API guide](docs/v3.md) and [reference](docs/v3-reference.md) should reflect behavioral changes. Keep detailed experiments and raw measurements in ignored `notes/`.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Forward the same workload options to serial Node and Bun runs.
const runner = fileURLToPath(new URL('./benchmark.mjs', import.meta.url));
for (const engine of ['node', 'bun']) {
    execFileSync(process.execPath, [runner, '--engine', engine, ...process.argv.slice(2)], {
        stdio: 'inherit',
    });
}

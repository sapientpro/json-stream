//tsc emits plain .js into both dist trees; without these markers Node reads
//dist/esm as CommonJS (or sniffs it, with a warning).
import {writeFileSync} from 'node:fs';

const directory = process.argv[2] ?? 'dist';
writeFileSync(directory + '/cjs/package.json', '{"type":"commonjs"}\n');
writeFileSync(directory + '/esm/package.json', '{"type":"module"}\n');

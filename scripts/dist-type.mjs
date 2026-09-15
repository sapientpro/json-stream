//tsc emits plain .js into both dist trees; without these markers Node reads
//dist/esm as CommonJS (or sniffs it, with a warning).
import {writeFileSync} from 'node:fs';

writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');
writeFileSync('dist/esm/package.json', '{"type":"module"}\n');

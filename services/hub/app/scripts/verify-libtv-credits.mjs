// LibTV now reads MySQL and prices a shared account before filtering.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const app=fileURLToPath(new URL('../',import.meta.url));
const test=fileURLToPath(new URL('../libtv-cost.test.mjs',import.meta.url));
const result=spawnSync(process.execPath,['--test',test],{cwd:app,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status ?? 1;

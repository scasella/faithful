// Runs the ADV3 sanity inputs (see adv3.mjs). Run after `pnpm exec tsc -b`: node packages/smt/redteam/strings-decode/probe-adv.mjs
import { translateWithIr } from '@faithful/translate';
import { ADV3 } from './adv3.mjs';
import { concreteMismatches } from './probe-lib.mjs';
for (const [name, src, inputs] of ADV3) {
  const w = translateWithIr(src, 'f');
  if (!w.result.ok) { console.log('REFUSED', name, JSON.stringify(w.result).slice(0, 300)); continue; }
  const mm = await concreteMismatches({ translation: w.result, ir: w.ir }, inputs);
  console.log(mm.length ? 'MISMATCH' : 'ok      ', name, mm.length ? JSON.stringify(mm).slice(0, 1500) : '');
}
process.exit(0);

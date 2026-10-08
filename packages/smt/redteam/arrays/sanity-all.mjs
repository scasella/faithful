import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const { sanityCheck, openZ3 } = await import(root + '/smt/dist/index.js');
const { translateWithIr } = await import(root + '/translate/dist/index.js');
const { Sandbox } = await import(root + '/engine/dist/index.js');
const dir = root + '/smt/redteam/arrays';
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const z3 = await openZ3('system');
const sandbox = await Sandbox.open();
let tot = { fns: 0, inputs: 0, compared: 0, mism: 0, fuel: 0, tsFaults: 0, solverMissing: 0 };
for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts')).sort()) {
  if (only && !only.test(f)) continue;
  const src = readFileSync(dir + '/' + f, 'utf8');
  for (const name of ['original', 'candidate']) {
    const w = translateWithIr(src, name);
    if (!w.result.ok) { console.log(f, name, 'REFUSED'); continue; }
    const t0 = Date.now();
    let r;
    try {
      r = await sanityCheck(w.result, w.ir, z3, { n: Number(process.env.N ?? 40), seed: Number(process.env.SEED ?? 7), sandbox, maxChars: Number(process.env.MAXC ?? 8000000) });
    } catch (e) { console.log(f, name, 'THREW', String(e).slice(0, 300)); continue; }
    tot.fns++; tot.inputs += r.inputs ?? 0; tot.compared += r.compared ?? 0; tot.fuel += r.fuel ?? 0; tot.tsFaults += r.tsFaults ?? 0; tot.solverMissing += r.solverMissing ?? 0;
    const m = r.mismatches ?? [];
    tot.mism += m.length;
    console.log(`${f} ${name}: inputs ${r.inputs} compared ${r.compared} fuel ${r.fuel} tsFaults ${r.tsFaults} solverMissing ${r.solverMissing} uniq ${r.uniquenessChecked} U=${r.unroll} mism ${m.length} ${r.note ?? ''} ${Date.now() - t0}ms`);
    for (const x of m.slice(0, 3)) console.log('   MISMATCH', JSON.stringify(x).slice(0, 600));
  }
}
console.log('TOTAL', JSON.stringify(tot));
await sandbox.close();
process.exit(0);

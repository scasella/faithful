// Usage (after `pnpm exec tsc -b`): node packages/smt/scripts/sanity-report.mjs [--wasm|--system] [--n 60]
// Runs SMT sanity mode over every in-subset corpus function and prints a summary plus one line per function.
import { fileURLToPath } from 'node:url';
import { sanityReport, openZ3 } from '../dist/index.js';
const args = process.argv.slice(2);
const kind = args.includes('--wasm') ? 'wasm' : args.includes('--system') ? 'system' : 'auto';
const n = Number(args[args.indexOf('--n') + 1]) || 60;
const z3 = await openZ3(kind);
const corpus = fileURLToPath(new URL('../../translate/corpus', import.meta.url));
const r = await sanityReport(corpus, z3, { n });
console.log(`SMT sanity ${new Date().toISOString()} z3 ${z3.kind} ${z3.version} Node ${process.version}`);
console.log(`functions ${r.functions}, encodable ${r.encodable}, inputs ${r.inputs}, compared ${r.compared}, agreements ${r.agreements}, fuel ${r.fuel}, ts faults ${r.tsFaults}, solver missing ${r.solverMissing}, mismatches ${r.mismatches}`);
console.log('unsupported constructs:', JSON.stringify(r.unsupported));
for (const f of r.reports) console.log(`${f.id}: compared ${f.compared}/${f.inputs}, fuel ${f.fuel}, mismatches ${f.mismatches.length}, U=${f.unroll}, ${Math.round(f.ms)} ms`);
process.exit(r.mismatches === 0 ? 0 : 1);

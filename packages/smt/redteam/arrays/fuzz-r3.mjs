// Round-3 array fuzzer (red team). Random in-subset functions over (xs: number[], ys: number[], i: number, j: number)
// built from the array primitives, plus one-step mutants of each. For every function: sanityCheck (encoder vs the
// instrumented original on generated inputs, plus uniqueness). For every (function, mutant) pair: brute force over ALL
// inputs within small bounds in the sandbox, and checkEquivalent at the same bounds; a disagreement is printed as BUG.
//   node packages/smt/redteam/arrays/fuzz-r3.mjs [count=40] [seed=1]
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const { sanityCheck, checkEquivalent, openZ3, runInstrumented } = await import(root + '/smt/dist/index.js');
const { translateWithIr } = await import(root + '/translate/dist/index.js');
const { Sandbox, outcomeEqual } = await import(root + '/engine/dist/index.js');

const COUNT = Number(process.argv[2] ?? 40);
let seed = Number(process.argv[3] ?? 1);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

let lamId = 0;
function genI(d, scope) {
  const leaves = ['i', 'j', String(Math.floor(rnd() * 7) - 3), ...scope];
  if (d <= 0) return pick(leaves);
  const r = rnd();
  if (r < 0.25) return pick(leaves);
  const A = () => genA(d - 1, scope);
  const I = () => genI(d - 1, scope);
  return pick([
    () => `${A()}.length`,
    () => `${A()}.indexOf(${I()})`,
    () => `${A()}.reduce((s${++lamId}, x${lamId}) => s${lamId} + x${lamId}, 0)`,
    () => { const n = ++lamId; return `${A()}.reduce((s${n}, x${n}, k${n}) => s${n} + x${n} * k${n}, ${I()})`; },
    () => `(${I()} + ${I()})`,
    () => `(${I()} - ${I()})`,
    () => `Math.max(${I()}, ${I()})`,
    () => `Math.min(${I()}, ${I()})`,
    () => { const a = A(); return `(${a}.length > 0 ? ${a}[0] : ${I()})`; },
    () => { const a = A(); return `(${a}.length > 0 ? ${a}[${a}.length - 1] : ${I()})`; },
    () => `(${A()}.includes(${I()}) ? 1 : 0)`,
    () => `(${I()} % 3)`,
    () => `(${genB(d - 1, scope)} ? ${I()} : ${I()})`,
  ])();
}
function genB(d, scope) {
  const I = () => genI(d, scope);
  return pick([() => `${I()} < ${I()}`, () => `${I()} === ${I()}`, () => `${I()} <= ${I()}`, () => `${genA(d, scope)}.includes(${I()})`])();
}
function genA(d, scope) {
  const leaves = ['xs', 'ys'];
  if (d <= 0) return pick(leaves);
  if (rnd() < 0.2) return pick(leaves);
  const A = () => genA(d - 1, scope);
  const I = () => genI(d - 1, scope);
  return pick([
    () => `${A()}.slice(${I()})`,
    () => `${A()}.slice(${I()}, ${I()})`,
    () => `${A()}.slice(${pick(['1', '2', '-1', '-2', '0'])})`,
    () => `${A()}.concat(${A()})`,
    () => { const n = ++lamId; return `${A()}.map((x${n}) => ${genI(d - 1, [...scope, `x${n}`])})`; },
    () => { const n = ++lamId; return `${A()}.map((x${n}, k${n}) => ${genI(d - 1, [...scope, `x${n}`, `k${n}`])})`; },
    () => { const n = ++lamId; return `${A()}.filter((x${n}) => ${genB(d - 1, [...scope, `x${n}`])})`; },
    () => { const n = ++lamId; return `${A()}.filter((x${n}, k${n}) => ${genB(d - 1, [...scope, `x${n}`, `k${n}`])})`; },
    () => `${A()}.slice().sort((a, b) => a - b)`,
    () => `${A()}.slice().sort((a, b) => b - a)`,
    () => `[${I()}, ${I()}]`,
    () => { const n = ++lamId; return `${A()}.reduce((acc${n}: number[], x${n}) => [x${n}].concat(acc${n}), [])`; },
    () => `(${genB(d - 1, scope)} ? ${A()} : ${A()})`,
  ])();
}

// one-step mutants: replace a token
const MUT = [
  [/ < /, ' <= '], [/ <= /, ' < '], [/a - b/, 'b - a'], [/b - a/, 'a - b'], [/\.slice\(1\)/, '.slice(2)'], [/\.slice\(-1\)/, '.slice(-2)'],
  [/\bxs\b/, 'ys'], [/\bys\b/, 'xs'], [/\+ 1\b/, '+ 2'], [/Math\.max/, 'Math.min'], [/Math\.min/, 'Math.max'], [/\[0\]/, '[1 - 1]'],
  [/ === /, ' <= '], [/\.indexOf\(/, '.lastIndexOfX('], [/, 0\)/, ', 1)'], [/\(-?\d\)/, '(0)'], [/ % 3/, ' % 2'], [/k(\d+)\b(?=[^=]*=>)/, 'k$1'],
];
function mutate(body) {
  const cands = MUT.filter(([re]) => re.test(body));
  if (!cands.length) return null;
  const [re, to] = pick(cands);
  const idx = [...body.matchAll(new RegExp(re.source, 'g'))];
  const m = pick(idx);
  const out = body.slice(0, m.index) + m[0].replace(re, to) + body.slice(m.index + m[0].length);
  return out === body || out.includes('lastIndexOfX') ? null : out;
}

const SIG = '(xs: number[], ys: number[], i: number, j: number)';
function srcOf(retTy, oBody, cBody) {
  return `export function original${SIG}: ${retTy} {\n  return ${oBody};\n}\nexport function candidate${SIG}: ${retTy} {\n  return ${cBody};\n}\n`;
}

const z3 = await openZ3('system');
const sandbox = await Sandbox.open();
const B = { array: 2, string: 1, int: 2 };
const arrs = [[]];
for (const a of [-2, -1, 0, 1, 2]) arrs.push([a]);
for (const a of [-2, -1, 0, 1, 2]) for (const b of [-2, -1, 0, 1, 2]) arrs.push([a, b]);
const ints = [-2, -1, 0, 1, 2];
const all = [];
for (const x of arrs) for (const y of arrs) for (const i of ints) for (const j of ints) all.push([x, y, i, j]);
// subsample deterministically to keep the sandbox time bounded (both functions run on the same inputs)
const inputs = all.filter((_, k) => k % 3 === 0);

let stats = { fns: 0, sanityCompared: 0, sanityMism: 0, pairs: 0, unsat: 0, sat: 0, other: 0, bugs: 0, refused: 0 };
for (let t = 0; t < COUNT; t++) {
  const retTy = rnd() < 0.5 ? 'number[]' : 'number';
  const body = retTy === 'number[]' ? genA(3, []) : genI(3, []);
  let mbody = mutate(body);
  for (let tries = 0; !mbody && tries < 5; tries++) mbody = mutate(body);
  if (!mbody) continue;
  const src = srcOf(retTy, body, mbody);
  const o = translateWithIr(src, 'original');
  const c = translateWithIr(src, 'candidate');
  if (!o.result.ok || !c.result.ok) { stats.refused++; continue; }
  const O = { translation: o.result, ir: o.ir };
  const C = { translation: c.result, ir: c.ir };
  stats.fns++;
  for (const [nm, F] of [['original', O], ['candidate', C]]) {
    try {
      const r = await sanityCheck(F.translation, F.ir, z3, { n: 30, seed: 7 + t, sandbox, maxChars: 8_000_000 });
      stats.sanityCompared += r.compared;
      if (r.mismatches.length || r.solverMissing) {
        stats.sanityMism += r.mismatches.length;
        console.log(`BUG(B) sanity ${nm} #${t}: ${JSON.stringify(r.mismatches.slice(0, 2)).slice(0, 800)} missing=${r.solverMissing}\n${src}`);
      }
    } catch (e) { console.log(`sanity threw #${t} ${nm}: ${String(e).slice(0, 300)}`); }
  }
  const r = await checkEquivalent(O, C, { ...B, unroll: 8 }, 120_000, z3, { sandbox });
  // an unsat is checked against EVERY input inside the bounds; otherwise a third of them suffices for the log
  const pool = r.status === 'unsat' ? all : inputs;
  const [ro, rc] = await runInstrumented([O.translation, C.translation], pool, { sandbox, perCallMs: 1000 });
  const diffs = pool.filter((_, k) => ro[k].tag !== 'fault' && ro[k].tag !== 'range-violation' && rc[k].tag !== 'fault' && !outcomeEqual(ro[k], rc[k]));
  stats.pairs++;
  if (r.status === 'unsat') stats.unsat++;
  else if (r.status === 'sat') stats.sat++;
  else stats.other++;
  if (r.status === 'unsat' && diffs.length) {
    stats.bugs++;
    console.log(`BUG(A) #${t}: unsat but differs on ${JSON.stringify(diffs[0])}\n${src}`);
  } else if (r.status === 'inconclusive') {
    stats.bugs++;
    console.log(`BUG(B) #${t}: inconclusive ${r.reason} ${JSON.stringify(r.counterexample).slice(0, 600)}\n${src}`);
  } else if (r.status !== 'unsat' && r.status !== 'sat') {
    console.log(`note #${t}: ${r.status} ${r.reason}`);
  }
}
console.log('STATS', JSON.stringify(stats));
await sandbox.close();
process.exit(0);

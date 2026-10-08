// Round-3 array fuzzer, part 2: string arrays and arrays of tuples. Signature
// (ss: string[], ps: [number, string][], i: number). Same protocol as fuzz-r3.mjs: sanityCheck on each function, and
// for each (function, one-step mutant) pair checkEquivalent at {array 2, string 1, int 1} against brute force over ALL
// inputs inside those bounds (strings over {"", "a", ","}).
//   node packages/smt/redteam/arrays/fuzz-r3-str.mjs [count=40] [seed=1]
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const { sanityCheck, checkEquivalent, openZ3, runInstrumented } = await import(root + '/smt/dist/index.js');
const { translateWithIr } = await import(root + '/translate/dist/index.js');
const { Sandbox, outcomeEqual } = await import(root + '/engine/dist/index.js');

const COUNT = Number(process.argv[2] ?? 40);
let seed = Number(process.argv[3] ?? 1);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
let id = 0;

function genS(d, sc) {
  // string
  const leaves = ['"a"', '","', '""', ...sc.s];
  if (d <= 0 || rnd() < 0.25) return pick(leaves);
  const S = () => genS(d - 1, sc);
  const SA = () => genSA(d - 1, sc);
  const I = () => genI(d - 1, sc);
  return pick([
    () => `${SA()}.join(${pick(['","', '""', '"a"', S()])})`,
    () => `${SA()}.join()`,
    () => `(${S()} + ${S()})`,
    () => { const a = SA(); return `(${a}.length > 0 ? ${a}[0] : ${S()})`; },
    () => { const a = SA(); return `(${a}.length > 0 ? ${a}[${a}.length - 1] : ${S()})`; },
    () => `${S()}.slice(${I()})`,
    () => `(${genB(d - 1, sc)} ? ${S()} : ${S()})`,
    () => { const n = ++id; return `${SA()}.reduce((acc${n}, x${n}) => acc${n} + x${n}, ${S()})`; },
  ])();
}
function genI(d, sc) {
  const leaves = ['i', String(Math.floor(rnd() * 5) - 2), ...sc.i];
  if (d <= 0 || rnd() < 0.25) return pick(leaves);
  const SA = () => genSA(d - 1, sc);
  const S = () => genS(d - 1, sc);
  const I = () => genI(d - 1, sc);
  return pick([
    () => `${SA()}.length`,
    () => `${S()}.length`,
    () => `${SA()}.indexOf(${S()})`,
    () => `${genPA(d - 1, sc)}.length`,
    () => { const n = ++id; return `${genPA(d - 1, sc)}.reduce((t${n}, p${n}) => t${n} + p${n}[0], 0)`; },
    () => { const p = genPA(d - 1, sc); return `(${p}.length > 0 ? ${p}[0][0] : ${I()})`; },
    () => `(${I()} + ${I()})`,
    () => `${S()}.indexOf(${S()})`,
  ])();
}
function genB(d, sc) {
  const S = () => genS(d, sc);
  const I = () => genI(d, sc);
  return pick([() => `${S()} < ${S()}`, () => `${S()} === ${S()}`, () => `${I()} < ${I()}`, () => `${genSA(d, sc)}.includes(${S()})`])();
}
function genSA(d, sc) {
  if (d <= 0 || rnd() < 0.2) return 'ss';
  const SA = () => genSA(d - 1, sc);
  const I = () => genI(d - 1, sc);
  return pick([
    () => `${SA()}.slice(${I()})`,
    () => `${SA()}.slice(${I()}, ${I()})`,
    () => `${SA()}.concat(${SA()})`,
    () => `${SA()}.slice().sort()`,
    () => `${SA()}.slice().sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))`,
    () => { const n = ++id; return `${SA()}.map((s${n}) => ${genS(d - 1, { ...sc, s: [...sc.s, `s${n}`] })})`; },
    () => { const n = ++id; return `${SA()}.map((s${n}, k${n}) => ${genS(d - 1, { s: [...sc.s, `s${n}`], i: [...sc.i, `k${n}`] })})`; },
    () => { const n = ++id; return `${SA()}.filter((s${n}) => ${genB(d - 1, { ...sc, s: [...sc.s, `s${n}`] })})`; },
    () => `${genS(d - 1, sc)}.split(${pick(['","', '""', '"a"'])})`,
    () => `${genPA(d - 1, sc)}.map((p) => p[1])`,
    () => `[${genS(d - 1, sc)}]`,
  ])();
}
function genPA(d, sc) {
  if (d <= 0 || rnd() < 0.3) return 'ps';
  const PA = () => genPA(d - 1, sc);
  return pick([
    () => `${PA()}.slice().sort((a, b) => a[0] - b[0])`,
    () => `${PA()}.slice().sort((a, b) => b[0] - a[0])`,
    () => `${PA()}.slice().sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))`,
    () => { const n = ++id; return `${PA()}.filter((q${n}) => ${genB(d - 1, { s: [...sc.s, `q${n}[1]`], i: [...sc.i, `q${n}[0]`] })})`; },
    () => `${PA()}.concat(${PA()})`,
    () => `${PA()}.slice(${genI(d - 1, sc)})`,
  ])();
}

const MUT = [
  [/ < /, ' <= '], [/a < b \? 1/, 'a < b ? -1'], [/a > b \? -1/, 'a > b ? 1'], [/a\[0\] - b\[0\]/, 'b[0] - a[0]'], [/b\[0\] - a\[0\]/, 'a[0] - b[0]'],
  [/\.join\(\)/, '.join(",")'], [/\.join\(","\)/, '.join()'], [/\.join\(""\)/, '.join(",")'], [/"a"/, '""'], [/","/, '"a"'], [/\[0\]\[0\]/, '[0][0] + 0'],
  [/\.slice\(\)\.sort\(\)/, '.slice()'], [/\[0\]/, '[1 - 1]'], [/ === /, ' < '], [/\.split\(""\)/, '.split(",")'], [/\bi\b/, '(i + 1)'],
];
function mutate(body) {
  const cands = MUT.filter(([re]) => re.test(body));
  if (!cands.length) return null;
  const [re, to] = pick(cands);
  const ms = [...body.matchAll(new RegExp(re.source, 'g'))];
  const m = pick(ms);
  const out = body.slice(0, m.index) + m[0].replace(re, to) + body.slice(m.index + m[0].length);
  return out === body ? null : out;
}

const SIG = '(ss: string[], ps: [number, string][], i: number)';
const z3 = await openZ3('system');
const sandbox = await Sandbox.open();
const B = { array: 2, string: 1, int: 1 };
const strs = ['', 'a', ','];
const ints = [-1, 0, 1];
const sas = [[], ...strs.map((a) => [a]), ...strs.flatMap((a) => strs.map((b) => [a, b]))];
const tups = ints.flatMap((n) => strs.map((s) => [n, s]));
const pas = [[], ...tups.map((a) => [a]), ...tups.flatMap((a) => tups.map((b) => [a, b]))];
const all = [];
for (const s of sas) for (const p of pas) for (const i of ints) all.push([s, p, i]);

const stats = { fns: 0, sanityCompared: 0, sanityMism: 0, pairs: 0, unsat: 0, sat: 0, other: 0, bugs: 0, refused: 0 };
for (let t = 0; t < COUNT; t++) {
  const retTy = pick(['string[]', 'number', 'string']);
  const body = retTy === 'string[]' ? genSA(3, { s: [], i: [] }) : retTy === 'number' ? genI(3, { s: [], i: [] }) : genS(3, { s: [], i: [] });
  let mbody = null;
  for (let tries = 0; !mbody && tries < 6; tries++) mbody = mutate(body);
  if (!mbody) continue;
  const src = `export function original${SIG}: ${retTy} {\n  return ${body};\n}\nexport function candidate${SIG}: ${retTy} {\n  return ${mbody};\n}\n`;
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
  stats.pairs++;
  if (r.status === 'unsat') stats.unsat++;
  else if (r.status === 'sat') stats.sat++;
  else stats.other++;
  if (r.status === 'unsat') {
    const [ro, rc] = await runInstrumented([O.translation, C.translation], all, { sandbox, perCallMs: 1000 });
    const diffs = all.filter((_, k) => ro[k].tag !== 'fault' && ro[k].tag !== 'range-violation' && rc[k].tag !== 'fault' && !outcomeEqual(ro[k], rc[k]));
    if (diffs.length) {
      stats.bugs++;
      console.log(`BUG(A) #${t}: unsat but differs on ${JSON.stringify(diffs[0])} (${diffs.length} of ${all.length})\n${src}`);
    }
  } else if (r.status === 'inconclusive') {
    stats.bugs++;
    console.log(`BUG(B) #${t}: inconclusive ${r.reason} ${JSON.stringify(r.counterexample).slice(0, 600)}\n${src}`);
  } else if (r.status !== 'sat') {
    console.log(`note #${t}: ${r.status} ${r.reason}`);
  }
}
console.log('STATS', JSON.stringify(stats));
await sandbox.close();
process.exit(0);

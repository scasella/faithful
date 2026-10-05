/**
 * Differential tests against real Lean: for each fixture, the emitted model must compile with no `sorry` (every emitted
 * definition's axioms are checked), and on every input
 *   - the instrumented runner agrees with the original JavaScript whenever it does not report range-violation,
 *   - Lean `rangeOk` (and `asciiOk`) is false exactly when the instrumented runner reports range-violation,
 *   - the Lean checked twin's outcome equals the runner's outcome (same tag; same value/message),
 *   - the Lean model's outcome equals the original's outcome whenever `pre` holds.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { resolveLeanDir } from '@faithful/core';
import { buildInstrumentedRunner, leanChkEvalExpr, leanEvalExpr, leanPredicateExpr, parseLeanOutcome, translate } from './index.js';
import { isLeanReserved, leanIdent } from './types.js';
import type { Outcome, Translation, Val } from './contracts.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;

// Relative import of the prover's Lean driver (tests only; the package itself depends on typescript alone).
const prover = (): Promise<typeof import('../../prover/src/lean.js')> => import('../../prover/src/lean.js');

export interface Fixture {
  name: string;
  src: string;
  fn: string;
  inputs: Val[][];
}

/** Run the original TypeScript (transpiled) on args; map results to Outcome like the runner does. */
export function runOriginal(src: string, fn: string, args: Val[]): Outcome {
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exportsObj: Record<string, (...a: unknown[]) => unknown> = {};
  new Function('exports', js)(exportsObj);
  try {
    const v = (exportsObj[fn] ?? exportsObj.default)!(...(JSON.parse(JSON.stringify(args)) as unknown[]));
    return { tag: 'ok', value: v === undefined ? null : (JSON.parse(JSON.stringify(v)) as Val) };
  } catch (e) {
    if (e instanceof Error && e.constructor === Error) return { tag: 'throw', message: e.message };
    if (typeof e === 'string') return { tag: 'throw', message: e };
    return { tag: 'fault', detail: String(e) };
  }
}

export function runner(t: Translation): (args: Val[]) => Outcome {
  return new Function(`return ${buildInstrumentedRunner(t)}`)() as (args: Val[]) => Outcome;
}

export const FIXTURES: Fixture[] = [
  {
    name: 'sum',
    fn: 'sum',
    src: `export function sum(xs: number[]): number { let acc = 0; for (let i = 0; i < xs.length; i++) { acc += xs[i]; } return acc; }`,
    inputs: [[[]], [[1, 2, 3]], [[-5, 5, 7]], [[9007199254740992, 1]], [[9007199254740991, 1]], [[-9007199254740992, -1]]],
  },
  {
    name: 'find (early return in a loop)',
    fn: 'find',
    src: `export function find(xs: number[], t: number): number { for (let i = 0; i < xs.length; i++) { if (xs[i] === t) return i; } return -1; }`,
    inputs: [[[], 1], [[4, 5, 6], 6], [[4, 5, 6], 7], [[1, 1], 1]],
  },
  {
    name: 'fact (recursion + throw)',
    fn: 'fact',
    src: `export function fact(n: number): number { if (n <= 1) return 1; if (n > 20) throw new Error("too big"); return n * fact(n - 1); }`,
    inputs: [[0], [1], [5], [-3], [18], [19], [21]],
  },
  {
    name: 'fib (double recursion)',
    fn: 'fib',
    src: `export function fib(n: number): number { if (n <= 1) return n; return fib(n - 1) + fib(n - 2); }`,
    inputs: [[0], [1], [10], [-4]],
  },
  {
    name: 'integer division and remainder',
    fn: 'ops',
    src: `export function ops(a: number, b: number): number[] { return [a % b, Math.floor(a / b), Math.ceil(a / b), Math.abs(a), Math.min(a, b), Math.max(a, b, 3), -a]; }`,
    inputs: [[-7, 3], [7, -3], [-7, -3], [7, 3], [0, 5], [5, 0], [-7, 2], [9007199254740992, 3], [-9007199254740992, 7]],
  },
  {
    name: 'string library (fixed)',
    fn: 'strs2',
    src: `export function strs2(s: string, i: number): string[] {
      return [s.charAt(i), s.slice(-2), s.slice(1, -1), s.slice(i), s.slice(i, i + 2), \`\${s.length}\`,
        s.toLowerCase(), s.toUpperCase(), s + i, "x" + true, s.indexOf("b") + ":" + s.indexOf("") + ":" + s.indexOf("zz") + ":" + s.indexOf("a", i)];
    }`,
    inputs: [['abc', 1], ['abc', 5], ['abc', -1], ['', 0], ['aBcab', 2], ['ÄBc', 0], ['aé"\\\n', 1]],
  },
  {
    name: 'split and join',
    fn: 'sj',
    src: `export function sj(s: string, sep: string): string[] { const parts = s.split(sep); return [parts.join("|"), "" + parts.length, [1, -2, 3].join(), parts.join(""), [true, false].join("/")]; }`,
    inputs: [['a,b,,c', ','], ['', ','], ['', ''], ['abc', ''], ['abab', 'ab'], ['aaa', 'aa'], ['a,b,', ',']],
  },
  {
    name: 'charCodeAt and indexing',
    fn: 'codes',
    src: `export function codes(s: string, i: number): number { return s.charCodeAt(i) + s[0].length; }`,
    inputs: [['abc', 0], ['abc', 2], ['abc', 3], ['abc', -1], ['', 0], ['é', 0]],
  },
  {
    name: 'string comparison',
    fn: 'cmp',
    src: `export function cmp(a: string, b: string): boolean[] { return [a < b, a <= b, a > b, a >= b, a === b, a !== b]; }`,
    inputs: [['a', 'b'], ['b', 'a'], ['ab', 'a'], ['', ''], ['Z', 'a'], ['é', 'z']],
  },
  {
    name: 'array library',
    fn: 'arr',
    src: `export function arr(xs: number[]): number[][] {
      return [xs.slice(1), xs.slice(1, -1), xs.slice(-2), xs.concat([9], xs), xs.map((x) => x * 2), xs.map((x, i) => x + i),
        xs.filter((x) => x > 1), xs.filter((x, i) => i % 2 === 0), [xs.reduce((a, x) => a + x, 0), xs.reduce((a, x, i) => a + x * i, 0)],
        [xs.indexOf(2), xs.indexOf(42), xs.includes(3) ? 1 : 0, xs.length]];
    }`,
    inputs: [[[]], [[1, 2, 3]], [[3, 2, 2, 1]], [[4503599627370497, 4503599627370496]]],
  },
  {
    name: 'sorts',
    fn: 'sorts',
    src: `type P = { k: number; s: string; id: number };
    export function sorts(xs: number[], ps: P[], ss: string[]): number[][] {
      const a = xs.slice().sort((p, q) => p - q);
      const d = xs.slice().sort((p, q) => q - p);
      const byK = ps.slice().sort((p, q) => p.k - q.k).map((p) => p.id);
      const byS = ps.slice().sort((p, q) => (p.s < q.s ? -1 : p.s > q.s ? 1 : 0)).map((p) => p.id);
      const byKd = ps.slice().sort((p, q) => q.k - p.k).map((p) => p.id);
      const plain = ss.slice().sort().map((s) => s.length);
      return [a, d, byK, byS, byKd, plain];
    }`,
    inputs: [
      [[3, 1, 2, 1], [{ k: 2, s: 'b', id: 0 }, { k: 1, s: 'a', id: 1 }, { k: 2, s: 'a', id: 2 }, { k: 1, s: 'b', id: 3 }], ['bb', 'a', 'ccc', 'B']],
      [[], [], []],
      [[9007199254740992, -9007199254740992, 0], [{ k: 9007199254740992, s: '', id: 0 }, { k: -9007199254740992, s: '', id: 1 }], ['é', 'e', 'z']],
    ],
  },
  {
    name: 'while loops (countdown, top-level increment, halving, shrinking)',
    fn: 'loops',
    src: `export function loops(n: number, xs: number[]): number[] {
      let a = n; let c1 = 0;
      while (a > 0) { c1 += a; a--; }
      let i = 0; let c2 = 0;
      while (i < n) { if (i === 5) break; c2 += 1; i++; }
      let h = n; let c3 = 0;
      while (h > 0) { h = Math.floor(h / 2); c3++; }
      let ys = xs; let c4 = 0;
      while (ys.length > 0) { c4 += ys[0]; ys = ys.slice(1); }
      return [c1, c2, c3, c4];
    }`,
    inputs: [[0, []], [10, [1, 2, 3]], [-3, [5]], [1, []]],
  },
  {
    name: 'for...of with break and continue, nested loops',
    fn: 'nested',
    src: `export function nested(xs: number[], ys: number[]): number {
      let total = 0;
      for (const x of xs) {
        if (x < 0) continue;
        if (x > 100) break;
        for (let j = 0; j < ys.length; j += 2) {
          if (ys[j] === x) continue;
          total += x * ys[j];
        }
      }
      return total;
    }`,
    inputs: [[[], [1]], [[1, 2, -1, 3, 200, 4], [1, 2, 3, 4, 5]], [[5], []]],
  },
  {
    name: 'return from a nested loop',
    fn: 'pairSum',
    src: `export function pairSum(xs: number[], t: number): [number, number] | null {
      for (let i = 0; i < xs.length; i++) {
        for (let j = i + 1; j < xs.length; j++) {
          if (xs[i] + xs[j] === t) return [i, j];
        }
      }
      return null;
    }`,
    inputs: [[[1, 2, 3, 4], 7], [[1, 2], 9], [[], 0]],
  },
  {
    name: 'records, tuples and joins',
    fn: 'stats',
    src: `interface Stats { min: number; max: number; count: number; label: string }
    export function stats(xs: number[], label: string): Stats {
      let lo = 0; let hi = 0; let n = 0;
      for (const x of xs) {
        if (n === 0 || x < lo) { lo = x; }
        if (n === 0 || x > hi) { hi = x; n = n + 0; }
        n++;
      }
      const pair: [number, string] = [n, label];
      return { min: lo, max: hi, count: pair[0], label: pair[1] + "!" };
    }`,
    inputs: [[[], 'e'], [[3, -1, 7], 'x']],
  },
  {
    name: 'option return with undefined',
    fn: 'firstNeg',
    src: `export function firstNeg(xs: number[]): number | undefined { for (const x of xs) { if (x < 0) return x; } return undefined; }`,
    inputs: [[[1, -2, -3]], [[1]], [[]]],
  },
  {
    name: 'option return via ternary and fall-through',
    fn: 'half',
    src: `export function half(n: number): number | undefined { if (n % 2 === 0) return n > 100 ? undefined : Math.floor(n / 2); }`,
    inputs: [[4], [3], [200], [-6]],
  },
  {
    name: 'recursion on a shrinking string',
    fn: 'countA',
    src: `export function countA(s: string): number { if (s.length === 0) return 0; return (s.charAt(0) === "a" ? 1 : 0) + countA(s.slice(1)); }`,
    inputs: [[''], ['banana'], ['aaa']],
  },
  {
    name: 'booleans, ternaries, module constants, name hygiene',
    fn: 'clamp',
    src: `const LIMIT = 10;
    const TAG = "t";
    export function clamp(max: number, fun: number, List: boolean): string {
      const ok = !List && (max > LIMIT || fun <= -LIMIT) && max !== fun;
      return ok ? TAG + max : (List ? "L" : "n") + fun;
    }`,
    inputs: [[11, 0, false], [11, 0, true], [5, -10, false], [5, 5, false]],
  },
  {
    name: 'throw inside a loop',
    fn: 'checkAll',
    src: `export function checkAll(xs: number[]): number { let s = 0; for (const x of xs) { if (x < 0) throw "negative"; s += x; } return s; }`,
    inputs: [[[1, 2]], [[1, -1, 2]], [[]]],
  },
  {
    name: 'ascii case mapping',
    fn: 'shout',
    src: `export function shout(s: string): string { return s.slice(1).toUpperCase() + s.toLowerCase(); }`,
    inputs: [['abC'], ['ß'], ['xé'], ['']],
  },
  {
    name: 'multiplication overflow and index checks',
    fn: 'prod',
    src: `export function prod(xs: number[], i: number): number { let p = 1; for (const x of xs) p *= x; return p + xs[i]; }`,
    inputs: [[[2, 3], 0], [[2, 3], 2], [[2, 3], -1], [[94906267, 94906267], 0], [[4096, 2199023255552], 0], [[4097, 2199023255552], 0]],
  },
  {
    name: 'short-circuit loop condition with an index (checks respect &&)',
    fn: 'skipSpaces',
    src: `export function skipSpaces(s: string, i: number): number { while (i < s.length && s[i] === " ") { i++; } return i; }`,
    inputs: [['  ab', 0], ['', 0], ['   ', 1], ['ab', 5], ['ab', -1]],
  },
  {
    name: 'loop inside an if-join, counting down',
    fn: 'rev',
    src: `export function rev(s: string, flag: boolean): string {
      let out = "";
      let n = 0;
      if (flag) {
        for (let i = s.length - 1; i >= 0; i--) { out += s.charAt(i); }
        n = 1;
      } else { out = s; }
      return out + n;
    }`,
    inputs: [['abc', true], ['abc', false], ['', true]],
  },
  {
    name: 'block callbacks with loops; reduce into tuple and record; string arrays',
    fn: 'cb',
    src: `type Acc = { n: number; s: string };
    export function cb(xs: number[], words: string[]): [number, string, boolean, number] {
      const tri = xs.map((x) => { let t = 0; for (let k = 1; k <= x; k++) { t += k; } return t; });
      const init: [number, number] = [0, 1];
      const pr = xs.reduce((a: [number, number], x): [number, number] => [a[0] + x, a[1] * 2], init);
      const acc = words.reduce((a: Acc, w) => ({ n: a.n + w.length, s: a.s + w.charAt(0) }), { n: 0, s: "" });
      const long = words.filter((w) => w.length > 2);
      return [tri.reduce((a, t) => a + t, 0) + pr[0] + pr[1], acc.s + long.join("+"), words.includes("hi"), acc.n];
    }`,
    inputs: [[[1, 2, 3], ['hi', 'there', 'you']], [[], []], [[-1, 4], ['', 'abc']]],
  },
  {
    name: 'recursion through || and && (call on the right of a short-circuit)',
    fn: 'even',
    src: `export function even(n: number): boolean { return n === 0 || (n >= 2 && even(n - 2)); }`,
    inputs: [[0], [1], [10], [7], [-2]],
  },
  {
    name: 'option recursion on a shrinking array',
    fn: 'lastPos',
    src: `export function lastPos(xs: number[]): number | null {
      if (xs.length === 0) return null;
      if (xs[xs.length - 1] > 0) return xs[xs.length - 1];
      return lastPos(xs.slice(1));
    }`,
    inputs: [[[]], [[1, 2, -3]], [[-1, -2]]],
  },
  {
    name: 'digits by halving recursion',
    fn: 'digits',
    src: `export function digits(n: number): number { if (n < 10) return 1; return 1 + digits(Math.floor(n / 10)); }`,
    inputs: [[0], [9], [10], [123456789], [-5]],
  },
  {
    name: 'tuples in arrays sorted by key index; template literal with booleans',
    fn: 'rank',
    src: `export function rank(ps: [string, number][]): string {
      const s = ps.slice().sort((a, b) => b[1] - a[1]);
      let out = "";
      for (const p of s) { out += \`\${p[0]}:\${p[1]}:\${p[1] > 0};\`; }
      return out;
    }`,
    inputs: [[[['a', 1], ['b', 3], ['c', 1], ['d', -2]]], [[]]],
  },
  {
    name: 'continue in for...of and early return of a record from a loop',
    fn: 'firstBig',
    src: `type Hit = { at: number; v: number };
    export function firstBig(xs: number[], lim: number): Hit | null {
      let i = 0;
      for (const x of xs) {
        i++;
        if (x <= lim) continue;
        return { at: i - 1, v: x };
      }
      return null;
    }`,
    inputs: [[[1, 5, 9], 4], [[1, 2], 4], [[], 0]],
  },
  {
    name: 'hostile names: Lean keywords, emitter heads, structure-generated field names',
    fn: 'mk',
    src: `type mk = { mk: number; rec: string; "x y": boolean };
    export function mk(lemma: number, at: string, Model: number[], Faithful: boolean, min: mk, τ1: number): mk {
      const fun = Model.length + lemma + τ1;
      let List = 0;
      for (const end of Model) { List = Math.max(List, end); }
      return { mk: Math.max(fun, min.mk) + List, rec: at + min.rec + (Faithful ? "y" : "n"), "x y": !min["x y"] };
    }`,
    inputs: [[1, 'a', [3, 9], true, { mk: 2, rec: 'r', 'x y': false }, 0]],
  },
  {
    name: 'zero parameters, export default',
    fn: 'answer',
    src: `export default function answer(): number[] { const xs: number[] = []; return xs.concat([6 * 7]); }`,
    inputs: [[]],
  },
  // red-team round 2, r2StrLengthLimit: string length bound (MAX_STRING_LENGTH = 2^24) at exactly the bound, for `+`,
  // template literals (one check after all substitutions: here the self-call throws before the too-long concatenation,
  // in JavaScript and in the twin), and `join`.
  {
    name: 'string length bound: doubling with +',
    fn: 'dbl',
    src: `export function dbl(s: string, k: number): number { let t = s; for (let i = 0; i < k; i++) { t = t + t; } return t.length; }`,
    inputs: [['a', 24], ['a', 25], ['ab', 3], ['', 40]],
  },
  {
    name: 'string length bound: a template literal is checked after its substitutions',
    fn: 'tpl',
    src: `export function tpl(s: string, n: number): string {
      if (n <= 0) throw new Error("done");
      let t = s;
      for (let i = 0; i < 24; i++) { t = t + t; } // |t| = 2^24 for s = "a": |t + t| exceeds the bound
      return \`\${t}\${t}\${tpl(s, n - 1)}\`;
    }`,
    inputs: [['a', 1], ['', 2], ['ab', 1]],
  },
  {
    name: 'string length bound: join',
    fn: 'jn',
    src: `export function jn(s: string, k: number): number { let xs = [s]; for (let i = 0; i < k; i++) { xs = xs.concat(xs); } return xs.join("--").length; }`,
    inputs: [['x'.repeat(4096), 11], ['x'.repeat(4096), 12], ['ab', 2], ['', 3]],
  },
  {
    name: 'throwing recursion with a ternary on the result',
    fn: 'sumTo',
    src: `export function sumTo(n: number): number { if (n < 0) throw new Error("negative"); if (n === 0) return 0; const r = sumTo(n - 1); return r > 1000 ? r : r + n; }`,
    inputs: [[0], [5], [-1], [60]],
  },
  // red-team round 3 (r3RecEmptyStrLeft*): the non-empty guard as one part of a compound condition; the Lean hypothesis
  // is a conjunction / negated disjunction, closed by the last alternative of `faithful_len_pos` (Core.lean)
  {
    name: 'termination: non-empty string guard inside a compound condition (either literal side)',
    fn: 'cnt',
    src: `export function cnt(s: string, n: number): number {
      if (s.charAt(0) !== "x" && "" !== s && n > 0) return 1 + cnt(s.slice(1), n - 1);
      if (!(s === "" || s.charAt(0) === "y")) return 10 + cnt(s.slice(2), n);
      return 0;
    }`,
    inputs: [['', 3], ['abc', 2], ['xyz', 5], ['yab', 1], ['abcdef', 0]],
  },
  // red-team round 3 (r3RunnerNameRun/Value/Input, r3FnNameRangeClass): user names equal to the runner's or the
  // runtime's own bindings
  { name: 'runner hygiene: a function named run', fn: 'run', src: `export function run(a: number): number { return a % 7; }`, inputs: [[10], [-10]] },
  { name: 'runner hygiene: a function named value', fn: 'value', src: `export function value(a: number): number { return Math.floor(a / 2); }`, inputs: [[10], [-7]] },
  { name: 'runner hygiene: a function named BigInt', fn: 'BigInt', src: `export function BigInt(a: number): number { return a * a; }`, inputs: [[3], [94906267]] },
];

describe.skipIf(!hasLean)('emitted Lean (real Lean, differential)', () => {
  for (const fx of FIXTURES) {
    it(fx.name, async () => {
      const t = translate(fx.src, fx.fn);
      if (!t.ok) throw new Error(`refused: ${JSON.stringify(t.refusal)}`);
      const { evalBatch, extractAxioms } = await prover();
      const defs = [...t.lean.source.matchAll(/^def (\S+)/gm)].map((m) => `Model.${m[1]}`);
      const prelude = t.lean.source + '\n' + defs.map((d) => `#print axioms ${d}`).join('\n') + '\n';
      const exprs: string[] = [];
      const hasAscii = t.preconditions.some((p) => p.kind === 'ascii');
      for (const args of fx.inputs) {
        exprs.push(leanEvalExpr(t, args), leanChkEvalExpr(t, args), leanPredicateExpr(t, 'rangeOk', args), leanPredicateExpr(t, 'pre', args));
        exprs.push(hasAscii ? leanPredicateExpr(t, 'asciiOk', args) : 'IO.println "true"');
      }
      const r = await evalBatch(prelude, exprs, { budgetMs: 120_000 });
      const errs = r.check.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => `${d.line}:${d.column} ${d.message}`), t.lean.source).toEqual([]);
      const ax = extractAxioms(r.check.diagnostics);
      for (const d of defs) {
        expect(ax[d], `axioms of ${d}`).toBeDefined();
        expect(ax[d]!.axioms).not.toContain('sorryAx');
        expect(ax[d]!.tier).toBe('proved');
      }
      expect(t.lean.source).not.toMatch(/\bsorry\b|\bpartial\b|\bunsafe\b/);
      const run = runner(t);
      fx.inputs.forEach((args, k) => {
        const what = `${fx.fn}(${JSON.stringify(args)})`;
        const orig = runOriginal(fx.src, fx.fn, args);
        const inst = run(args);
        const model = parseLeanOutcome(r.outputs[5 * k]);
        const chk = parseLeanOutcome(r.outputs[5 * k + 1]);
        const rangeOk = r.outputs[5 * k + 2];
        const pre = r.outputs[5 * k + 3];
        const asciiOk = r.outputs[5 * k + 4];
        expect(asciiOk, `asciiOk: ${what}`).toBe(inst.tag === 'range-violation' && inst.detail.startsWith('ascii') ? 'false' : 'true');
        if (inst.tag !== 'range-violation') expect(inst, `instrumented vs original: ${what}`).toEqual(orig);
        expect(chk.tag, `chk vs instrumented: ${what}`).toBe(inst.tag);
        if (inst.tag !== 'range-violation') expect(chk, `chk vs instrumented: ${what}`).toEqual(inst);
        if (inst.tag === 'range-violation' && /^(range|bounds|nonzero|depth|length)/.test(inst.detail)) expect(rangeOk, `rangeOk: ${what}`).toBe('false');
        if (inst.tag !== 'range-violation') {
          expect(rangeOk, `rangeOk: ${what}`).toBe('true');
          expect(pre, `pre: ${what}`).toBe('true');
        }
        if (pre === 'true') expect(model, `model vs original: ${what}`).toEqual(orig);
      });
    });
  }
});

// Red-team round 4 (r4TokParam/Local/Field/FnName/TacticsTo): a user name equal to an identifier-shaped Lean token
// (`using`, `until`, `matches`, `repeat`, Mathlib's `to`) does not parse. The reserved list in types.ts was dumped from
// the parser's token table; this re-dumps it under both imports a model meets (the model's `Faithful.Core`, and
// `Faithful.Tactics`, which a theorem file uses instead) and checks that every such token is reserved and renamed.
describe.skipIf(!hasLean)('Lean name hygiene (real Lean token table)', () => {
  const DUMP =
    'open Lean in\n' +
    'def faithfulTokenDump : Elab.Command.CommandElabM Unit := do\n' +
    '  let toks : Array String := (Parser.parserExtension.getState (← getEnv)).tokens.findPrefix ""\n' +
    '  IO.println (" ".intercalate toks.toList)\n';
  for (const imports of ['import Faithful.Tactics', 'import Faithful.Core\nimport Lean']) {
    it(`every identifier-shaped token is reserved (${imports.replace('\n', ' + ')})`, async () => {
      const { evalBatch } = await prover();
      const r = await evalBatch(`${imports}\n${DUMP}`, ['faithfulTokenDump'], { budgetMs: 120_000 });
      const errs = r.check.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => `${d.line}:${d.column} ${d.message}`)).toEqual([]);
      const toks = (r.outputs[0] ?? '').split(/\s+/).filter((t) => /^[A-Za-z][A-Za-z0-9_]*$/.test(t));
      expect(toks.length).toBeGreaterThan(100);
      expect(toks).toContain('using');
      expect(toks.filter((t) => !isLeanReserved(t))).toEqual([]);
      for (const t of toks) expect(leanIdent(t)).not.toBe(t);
    });
  }
});

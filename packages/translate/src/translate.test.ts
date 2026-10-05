import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FAITHFUL_TS_RUNTIME, MAX_RECURSION_DEPTH, MAX_STRING_LENGTH, buildInstrumentedRunner, leanIdent, listExportedFunctions, parseLeanOutcome, translate, translateWithIr, valueToLean,
  type Expr, type IrProgram, type Translation,
} from './index.js';
import type { Outcome, Val } from './contracts.js';

function ok(src: string, fn = 'f'): Translation {
  const r = translate(src, fn);
  if (!r.ok) throw new Error(`refused: ${r.refusal.code}: ${r.refusal.reason}`);
  return r;
}
function ir(src: string, fn = 'f'): IrProgram {
  const r = translateWithIr(src, fn);
  if (!r.result.ok || !r.ir) throw new Error(`refused: ${JSON.stringify(!r.result.ok && r.result.refusal)}`);
  return r.ir;
}
function prims(p: IrProgram): Set<string> {
  const out = new Set<string>();
  const walk = (e: Expr): void => {
    if (e.e === 'prim') out.add(e.op);
    for (const v of Object.values(e)) {
      if (v && typeof v === 'object' && 'e' in (v as object)) walk(v as Expr);
      if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object' && 'e' in x) walk(x as Expr);
      if (v && typeof v === 'object' && 'key' in (v as object)) walk((v as { key: Expr }).key);
    }
    if (e.e === 'record') for (const f of e.fields) walk(f.value);
  };
  for (const f of p.functions) walk(f.body);
  return out;
}

describe('library functions map to the documented Lean helpers', () => {
  const T: Array<[string, string, string, string]> = [
    // [signature, body expression, IR prim, Lean text]
    ['(a: number, b: number): number', 'a % b', 'tmod', 'Int.tmod a b'],
    ['(a: number, b: number): number', 'Math.floor(a / b)', 'fdiv', 'Int.fdiv a b'],
    ['(a: number, b: number): number', 'Math.ceil(a / b)', 'cdiv', 'Faithful.cdiv a b'],
    ['(a: number): number', 'Math.abs(a)', 'abs', 'Faithful.iabs a'],
    ['(a: number, b: number): number', 'Math.min(a, b)', 'min', 'Min.min a b'],
    ['(a: number, b: number): number', 'Math.max(a, b)', 'max', 'Max.max a b'],
    ['(s: string): number', 's.length', 'strLen', '((s).length : Int)'],
    ['(s: string, i: number): string', 's.charAt(i)', 'charAt', 'Faithful.charAt s i'],
    ['(s: string, i: number): number', 's.charCodeAt(i)', 'charCodeAt', 'Faithful.charCodeAt s i'],
    ['(s: string, i: number): string', 's[i]', 'strAt', 'Faithful.strAt s i'],
    ['(s: string): string', 's.slice(1, -1)', 'strSlice', 'Faithful.slice s (1 : Int) (-1 : Int)'],
    ['(s: string): string', 's.slice(-2)', 'strSliceFrom', 'Faithful.sliceFrom s (-2 : Int)'],
    ['(s: string): number', 's.indexOf("b")', 'strIndexOf', "Faithful.strIndexOf s ['b'] (0 : Int)"],
    ['(s: string): string[]', 's.split(",")', 'split', "Faithful.split s [',']"],
    ['(xs: string[]): string', 'xs.join("-")', 'join', "Faithful.join xs ['-']"],
    ['(s: string): string', 's.toLowerCase()', 'toLower', 'Faithful.toLower s'],
    ['(s: string): string', 's.toUpperCase()', 'toUpper', 'Faithful.toUpper s'],
    ['(n: number): string', '`n=${n}`', 'intToStr', 'Faithful.intToStr n'],
    ['(s: string, t: string): string', 's + t', 'strConcat', '(s ++ t)'],
    ['(s: string, t: string): boolean', 's < t', 'lt', 'Faithful.strLt s t'],
    ['(xs: number[]): number', 'xs.length', 'len', '((xs).length : Int)'],
    ['(xs: number[], i: number): number', 'xs[i]', 'at', 'Faithful.getD xs i'],
    ['(xs: number[]): number[]', 'xs.slice(1, 2)', 'slice', 'Faithful.slice xs (1 : Int) (2 : Int)'],
    ['(xs: number[]): number[]', 'xs.concat(xs)', 'concat', '(xs ++ xs)'],
    ['(xs: number[]): number[]', 'xs.map((x) => x + 1)', 'map', 'List.map'],
    ['(xs: number[]): number[]', 'xs.map((x, i) => x + i)', 'mapI', 'Faithful.mapI'],
    ['(xs: number[]): number[]', 'xs.filter((x) => x > 1)', 'filter', 'List.filter'],
    ['(xs: number[]): number[]', 'xs.filter((x, i) => i > 1)', 'filterI', 'Faithful.filterI'],
    ['(xs: number[]): number', 'xs.reduce((a, x) => a + x, 0)', 'foldl', 'List.foldl'],
    ['(xs: number[]): number', 'xs.reduce((a, x, i) => a + i, 0)', 'foldlI', 'Faithful.foldlI'],
    ['(xs: number[]): number', 'xs.indexOf(3)', 'indexOf', 'Faithful.indexOf xs (3 : Int)'],
    ['(xs: number[]): boolean', 'xs.includes(3)', 'includes', 'Faithful.includes xs (3 : Int)'],
    ['(xs: number[]): number[]', 'xs.slice().sort((a, b) => a - b)', 'sortBy', 'List.mergeSort'],
    ['(xs: number[]): string', 'xs.join()', 'join', 'Faithful.intToStr'],
  ];
  for (const [sig, body, op, lean] of T) {
    it(`${body} -> ${op}`, () => {
      const src = `export function f${sig} { return ${body}; }`;
      expect(prims(ir(src)).has(op)).toBe(true);
      expect(ok(src).lean.source).toContain(lean);
    });
  }
  it('comparators: ascending, descending, by key, three-way on strings', () => {
    const p = ir(`type P = { k: number; s: string };
      export function f(ps: P[]): P[][] {
        return [ps.slice().sort((a, b) => b.k - a.k), ps.slice().sort((a, b) => a.s < b.s ? -1 : a.s > b.s ? 1 : 0),
                ps.slice().sort((x, y) => x.s === y.s ? 0 : x.s > y.s ? -1 : 1)];
      }`);
    const specs: Array<{ desc: boolean; key: string }> = [];
    const walk = (e: Expr): void => {
      if (e.e === 'prim' && e.op === 'sortBy') specs.push({ desc: e.sort!.descending, key: e.sort!.keyTy });
      if (e.e === 'list') e.elems.forEach(walk);
    };
    walk(p.functions[0]!.body);
    expect(specs).toEqual([
      { desc: true, key: 'int' },
      { desc: false, key: 'string' },
      { desc: true, key: 'string' },
    ]);
  });
  it('refuses comparators that are not a consistent key order', () => {
    const r = translate('export function f(xs: number[]): number[] { return xs.slice().sort((a, b) => a < b ? -1 : 1); }', 'f');
    expect(!r.ok && r.refusal.code).toBe('unsupported-syntax');
    expect(!r.ok && r.refusal.reason).toMatch(/0 for equal keys/);
  });
});

describe('control constructs lower to the documented IR', () => {
  it('a counting for loop becomes a loop function with an int measure', () => {
    const p = ir('export function f(n: number): number { let s = 0; for (let i = 0; i < n; i += 2) { s = s + i; } return s; }');
    expect(p.functions.map((f) => f.role)).toEqual(['loop', 'main']);
    const loop = p.functions[0]!;
    expect(loop.measure?.kind).toBe('int');
    expect(loop.params.map((x) => x.name)).toEqual(['n', 's', 'i']);
    expect(loop.ret).toEqual({ k: 'state', elems: [{ k: 'int' }, { k: 'int' }] });
  });
  it('for...of is structural; a loop that returns yields a Flow', () => {
    const p = ir('export function f(xs: number[]): boolean { for (const x of xs) { if (x > 2) return true; } return false; }');
    expect(p.functions[0]!.measure?.kind).toBe('list-length');
    expect(p.functions[0]!.ret.k).toBe('flow');
  });
  it('while loops: countdown, top-level increment, halving, shrinking', () => {
    const kinds = (src: string): unknown[] => ir(src).functions.filter((f) => f.role === 'loop').map((f) => [f.measure?.kind, f.measure && 'hints' in f.measure ? f.measure.hints.map((h) => h.kind) : []]);
    expect(kinds('export function f(n: number): number { while (n > 0) { n--; } return n; }')).toEqual([['int', []]]);
    expect(kinds('export function f(n: number): number { let i = 0; while (i <= n) { i = i + 3; } return i; }')).toEqual([['int', []]]);
    expect(kinds('export function f(n: number): number { while (n >= 1) { n = Math.floor(n / 10); } return n; }')).toEqual([['int', ['fdiv']]]);
    expect(kinds('export function f(xs: number[]): number { while (xs.length !== 0) { xs = xs.slice(1); } return 0; }')).toEqual([['length', ['slice']]]);
  });
  it('break and continue, if-joins with several variables', () => {
    const p = ir(`export function f(xs: number[]): number[] {
      let a = 0; let b = 0;
      for (let i = 0; i < xs.length; i++) { if (xs[i] < 0) continue; if (xs[i] > 9) break; if (xs[i] % 2 === 0) { a += 1; b += xs[i]; } else { b -= 1; } }
      return [a, b];
    }`);
    expect(p.functions).toHaveLength(2);
    let joins = 0;
    const walk = (e: Expr): void => {
      if (e.e === 'letState' && e.value.e === 'if') joins++;
      for (const v of Object.values(e)) if (v && typeof v === 'object' && 'e' in (v as object)) walk(v as Expr);
    };
    walk(p.functions[0]!.body);
    expect(joins).toBeGreaterThanOrEqual(1);
  });
  it('recursion measures: decrement under a guard, halving, shrinking', () => {
    expect(ir('export function f(n: number): number { if (n < 2) return n; return f(n - 1) + f(n - 2); }').functions[0]!.measure?.kind).toBe('int');
    expect(ir('export function f(n: number): number { if (n <= 0) return 0; return 1 + f(Math.floor(n / 2)); }').functions[0]!.measure).toMatchObject({ kind: 'int', hints: [{ kind: 'fdiv' }] });
    expect(ir('export function f(xs: number[]): number { if (xs.length === 0) return 0; return xs[0] + f(xs.slice(1)); }').functions[0]!.measure).toMatchObject({ kind: 'length' });
    expect(ir('export function f(n: number): number { return n; }').functions[0]!.measure).toBeNull();
  });
  it('a throw makes the function (and the loops that reach it) Except', () => {
    const p = ir('export function f(xs: number[]): number { let s = 0; for (const x of xs) { if (x < 0) throw new Error("neg"); s += x; } return s; }');
    expect(p.throws).toBe(true);
    expect(p.functions.every((f) => f.throws)).toBe(true);
    const t = ok('export function f(xs: number[]): number { let s = 0; for (const x of xs) { if (x < 0) throw new Error("neg"); s += x; } return s; }');
    expect(t.canThrow).toBe(true);
    expect(t.lean.retType).toBe('Except String (Int)');
    expect(t.throwSites).toEqual([{ message: 'neg', span: expect.objectContaining({ line: 1 }) }]);
  });
});

describe('Translation output', () => {
  const src = 'export function f(xs: string[], n: number): string { return xs.join(",").toLowerCase() + n; }';
  it('names, types, hashes, preconditions', () => {
    const t = ok(src);
    expect(t.lean.source.startsWith('import Faithful.Core\n')).toBe(true);
    expect(t.lean.source).toContain('namespace Model');
    expect(t.lean.names).toEqual({ original: 'Model.f', rangeOk: 'Model.f_rangeOk', pre: 'Model.f_pre' });
    expect(t.lean.paramTypes).toEqual(['List (List Char)', 'Int']);
    expect(t.lean.paramNames).toEqual(['xs', 'n']);
    expect(ok('export function g(max: number, fun: string): number { return max; }', 'g').lean.paramNames).toEqual(['max_', 'fun_']);
    expect(t.lean.retType).toBe('List Char');
    expect(t.lean.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(t.source.text).toBe(src);
    expect(t.preconditions.map((p) => p.kind)).toEqual(['int-bound', 'bmp', 'range-ok', 'ascii']);
    expect(t.preconditions.find((p) => p.kind === 'range-ok')!.ts).toBeUndefined();
    expect(t.preconditions.find((p) => p.kind === 'range-ok')!.lean).toBe('Model.f_rangeOk xs n');
    const intTs = new Function('xs', 'n', `return ${t.preconditions[0]!.ts}`);
    expect(intTs([], 3)).toBe(true);
    expect(intTs([], 2 ** 53 + 2)).toBe(false);
    expect(intTs([], 1.5)).toBe(false);
    const bmpTs = new Function('xs', 'n', `return ${t.preconditions[1]!.ts}`);
    expect(bmpTs(['abc', 'é'], 0)).toBe(true);
    expect(bmpTs(['a😀'], 0)).toBe(false);
    expect(bmpTs(['\uD800'], 0)).toBe(false);
    expect(t.notes.join('\n')).toMatch(/UTF-16 gap/);
    expect(t.notes.join('\n')).toMatch(/ASCII/);
  });
  it('is deterministic and fast when warm', () => {
    const a = ok(src);
    const t0 = performance.now();
    const fresh = translate(src + '\n// different text, same function\n', 'f');
    const ms = performance.now() - t0;
    expect(fresh.ok && fresh.lean.source).toBe(a.lean.source);
    expect(ms).toBeLessThan(1000);
  });
  it('lists functions for the file picker', () => {
    const list = listExportedFunctions(`/** doc */
export function a(x: number): number { return x; }
function b(): number { return 1; }
export const c = (x: number): number => x;
const d = function (): number { return 2; };
export { d };`);
    expect(list).toEqual([
      { name: 'a', line: 2, hasJsDoc: true, exported: true },
      { name: 'b', line: 3, hasJsDoc: false, exported: false },
      { name: 'c', line: 4, hasJsDoc: false, exported: true },
      { name: 'd', line: 5, hasJsDoc: false, exported: true },
    ]);
  });
  it('arrow-function exports translate', () => {
    expect(ok('export const g = (x: number): number => x * 2;', 'g').lean.source).toContain('def g (x : Int) : Int');
  });
});

describe('value codecs', () => {
  it('valueToLean', () => {
    expect(valueToLean({ k: 'int' }, -5)).toBe('(-5 : Int)');
    expect(valueToLean({ k: 'string' }, 'a"\\\n\'é')).toBe("['a', '\"', '\\\\', '\\n', '\\'', '\\u00e9']");
    expect(valueToLean({ k: 'string' }, '')).toBe('([] : List Char)');
    expect(valueToLean({ k: 'array', elem: { k: 'int' } }, [])).toBe('([] : List (Int))');
    expect(valueToLean({ k: 'tuple', elems: [{ k: 'int' }, { k: 'bool' }, { k: 'string' }] }, [1, true, 'x'])).toBe("((1 : Int), true, ['x'])");
    expect(valueToLean({ k: 'option', inner: { k: 'int' } }, null)).toBe('(none : Option (Int))');
    expect(() => valueToLean({ k: 'int' }, 1.5)).toThrow();
    expect(() => valueToLean({ k: 'int' }, 2 ** 53 + 2)).toThrow();
    expect(() => valueToLean({ k: 'string' }, '\uD800')).toThrow(/surrogate/);
    const t = ok('type P = { x: number; "y": string };\nexport function f(p: P): P { return p; }');
    expect(valueToLean(t.params[0]!.ty, { x: 1, y: 'a' }, t.lean.records)).toBe("({ x := (1 : Int), y := ['a'] } : Model.P)");
  });
  it('parseLeanOutcome', () => {
    expect(parseLeanOutcome('{"tag":"ok","value":[1,2]}')).toEqual({ tag: 'ok', value: [1, 2] });
    expect(parseLeanOutcome('{"tag":"throw","message":"m"}\n')).toEqual({ tag: 'throw', message: 'm' });
    expect(parseLeanOutcome('Except.ok 3').tag).toBe('fault');
    expect(parseLeanOutcome(null).tag).toBe('fault');
    expect(parseLeanOutcome('{"tag":"ok"}').tag).toBe('fault');
  });
});

describe('instrumentation', () => {
  const rt = new Function(`${FAITHFUL_TS_RUNTIME}; return __faithful;`)() as Record<string, (...a: unknown[]) => unknown>;
  const MAX = 2 ** 53;
  const exact = (f: () => unknown): 'ok' | 'violation' => {
    try {
      f();
      return 'ok';
    } catch (e) {
      if (e && typeof e === 'object' && 'detail' in e) return 'violation';
      throw e;
    }
  };
  it('add/sub/mul are exact at ±2^53 (BigInt at the edge)', () => {
    expect(exact(() => rt.add!(MAX - 1, 1, 's'))).toBe('ok');
    expect(exact(() => rt.add!(MAX, 1, 's'))).toBe('violation'); // rounds to 2^53 in doubles
    expect(exact(() => rt.sub!(-MAX, 1, 's'))).toBe('violation');
    expect(exact(() => rt.mul!(4096, 2 ** 41, 's'))).toBe('ok');
    expect(exact(() => rt.mul!(94906267, 94906267, 's'))).toBe('violation');
    const big = fc.bigInt({ min: -(2n ** 53n), max: 2n ** 53n });
    fc.assert(
      fc.property(big, big, (a, b) => {
        const s = a + b;
        const p = a * b;
        expect(exact(() => rt.add!(Number(a), Number(b), 's'))).toBe(s >= -(2n ** 53n) && s <= 2n ** 53n ? 'ok' : 'violation');
        expect(exact(() => rt.mul!(Number(a), Number(b), 's'))).toBe(p >= -(2n ** 53n) && p <= 2n ** 53n ? 'ok' : 'violation');
      }),
      { numRuns: 3000 },
    );
  });
  it('Math.floor(a / b) and Math.ceil(a / b) equal exact floor/ceil division for |a|, |b| <= 2^53', () => {
    const edge = fc.oneof(
      fc.bigInt({ min: -(2n ** 53n), max: 2n ** 53n }),
      fc.bigInt({ min: 2n ** 53n - 1000n, max: 2n ** 53n }),
      fc.bigInt({ min: -(2n ** 53n), max: -(2n ** 53n) + 1000n }),
      fc.bigInt({ min: -1000n, max: 1000n }),
    );
    const floorDiv = (a: bigint, b: bigint): bigint => {
      const q = a / b;
      return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
    };
    fc.assert(
      fc.property(edge, edge, (a, b) => {
        fc.pre(b !== 0n);
        const f = Math.floor(Number(a) / Number(b));
        const c = Math.ceil(Number(a) / Number(b));
        expect(BigInt(f)).toBe(floorDiv(a, b));
        expect(BigInt(c)).toBe(-floorDiv(-a, b));
        // and % is exact with the sign of the dividend (Int.tmod)
        expect(BigInt(Number(a) % Number(b))).toBe(a % b);
      }),
      { numRuns: 20000 },
    );
  });
  it('instrumented runner: outcomes and unchanged behavior', () => {
    const t = ok('export function f(xs: number[], i: number): number { if (i < -5) throw new Error("low"); return xs[i] * 2 + xs.slice().sort((a, b) => b - a)[0]; }');
    const run = new Function(`return ${buildInstrumentedRunner(t)}`)() as (a: Val[]) => Outcome;
    expect(run([[1, 2], 1])).toEqual({ tag: 'ok', value: 6 });
    expect(run([[1, 2], 2]).tag).toBe('range-violation');
    expect(run([[1, 2], -9])).toEqual({ tag: 'throw', message: 'low' });
    expect(t.instrumentedTs).toContain('__faithful.at(xs, i');
    expect(t.instrumentedTs).toContain('(a, b) => b - a'); // comparator untouched
    expect(t.instrumentedTs).not.toMatch(/export/);
  });
  it('runner reports faults for non-literal errors', () => {
    const t = ok('export function f(xs: number[]): number[] { return xs.map((x) => x); }');
    const run = new Function(`return ${buildInstrumentedRunner(t)}`)() as (a: Val[]) => Outcome;
    expect(run([[1, 2]])).toEqual({ tag: 'ok', value: [1, 2] });
    expect(run([5 as unknown as Val]).tag).toBe('fault'); // TypeError: xs.map is not a function
  });

  // Recursion depth is part of range-ok (MAX_RECURSION_DEPTH): before red-team round 1 a depth of 1e7 was a stack
  // overflow (`fault`) while the Lean model claimed a value with pre = true.
  it('runner reports recursion deeper than MAX_RECURSION_DEPTH as a range violation, at exactly the bound', () => {
    const t = ok('export function f(n: number): number { if (n <= 0) return 0; return 1 + f(n - 1); }');
    const run = new Function(`return ${buildInstrumentedRunner(t)}`)() as (a: Val[]) => Outcome;
    expect(run([3])).toEqual({ tag: 'ok', value: 3 });
    // f(n) has n + 1 activations: n = D - 1 is the deepest input inside the model
    expect(run([MAX_RECURSION_DEPTH - 1])).toEqual({ tag: 'ok', value: MAX_RECURSION_DEPTH - 1 });
    expect(run([MAX_RECURSION_DEPTH])).toEqual({ tag: 'range-violation', detail: 'depth check failed at line 1: f(n - 1)' });
    expect(run([1e7]).tag).toBe('range-violation');
    // the depth counter is restored after a violation
    expect(run([5])).toEqual({ tag: 'ok', value: 5 });
  });

  // Red-team round 2, r2StrLengthLimit: V8 throws RangeError beyond 2^29 - 24 string units, the model is total. Every
  // concatenation (`+`, `+=`, template literal) and `join` result is bounded by MAX_STRING_LENGTH, checked before
  // concatenating (so V8's own error is never reached).
  it('string length bound: helpers are exact at MAX_STRING_LENGTH and check before concatenating', () => {
    const L = MAX_STRING_LENGTH;
    expect(L).toBe(2 ** 24);
    const a = 'a'.repeat(L / 2);
    expect(exact(() => rt.concat!(a, a, 's'))).toBe('ok');
    expect(exact(() => rt.concat!(a, a + 'b', 's'))).toBe('violation');
    expect(exact(() => rt.concat!('x'.repeat(L - 2), 12, 's'))).toBe('ok');
    expect(exact(() => rt.concat!('x'.repeat(L - 2), 123, 's'))).toBe('violation');
    expect(rt.concat!(1, 'x', 's')).toBe(1 + 'x');
    expect(rt.concat!('x', true, 's')).toBe('x' + true);
    expect(rt.template!('s', 'a', 1, 'b', false)).toBe(`a${1}b${false}`);
    expect(exact(() => rt.template!('s', a, a))).toBe('ok');
    expect(exact(() => rt.template!('s', a, a, '!'))).toBe('violation');
    expect(rt.join!('s', [1, 2, 3])).toBe('1,2,3');
    expect(rt.join!('s', ['a', 'b'], '--')).toBe('a--b');
    expect(rt.join!('s', [], '--')).toBe('');
    // L/2 + 1 + L/2 - 1 = L units (inside); one more unit is a violation
    expect(exact(() => rt.join!('s', [a, 'x'.repeat(L / 2 - 1)], '-'))).toBe('ok');
    expect(exact(() => rt.join!('s', [a, 'x'.repeat(L / 2)], '-'))).toBe('violation');
    // the engine's own limit is far above the bound (measured, Node v25.8.1): a string of 2^28 units exists
    expect(('a'.repeat(2 ** 14)).repeat(2 ** 14).length).toBe(2 ** 28);
  });
  it('runner reports strings longer than MAX_STRING_LENGTH as a range violation, at exactly the bound', () => {
    const t = ok('export function f(s: string, k: number): number { let t = s; for (let i = 0; i < k; i++) { t = t + t; } return t.length; }');
    const run = new Function(`return ${buildInstrumentedRunner(t)}`)() as (a: Val[]) => Outcome;
    expect(run(['a', 24])).toEqual({ tag: 'ok', value: MAX_STRING_LENGTH });
    expect(run(['a', 25])).toEqual({ tag: 'range-violation', detail: 'length check failed at line 1: t + t' });
    expect(run(['a', 30]).tag).toBe('range-violation'); // the probe: V8 itself would throw RangeError here
    expect(run(['', 30])).toEqual({ tag: 'ok', value: 0 });
    const u = ok('export function f(s: string, k: number): number { let t = s; for (let i = 0; i < k; i++) { t += `${t}`; } return t.length; }');
    const runU = new Function(`return ${buildInstrumentedRunner(u)}`)() as (a: Val[]) => Outcome;
    expect(runU(['a', 24])).toEqual({ tag: 'ok', value: MAX_STRING_LENGTH });
    expect(runU(['a', 25]).tag).toBe('range-violation');
    expect(u.instrumentedTs).toContain('__faithful.concat(t,');
  });
  it('a template literal is checked once, after all of its substitutions (JavaScript order)', () => {
    const p = ir('export function f(a: string, b: number, c: boolean): string { return `<${a}|${b}|${c}>`; }');
    let checked = 0;
    let unchecked = 0;
    const walk = (e: Expr): void => {
      if (e.e === 'prim' && e.op === 'strConcat') {
        if (e.unchecked) unchecked++;
        else {
          checked++;
          expect(e.site?.text).toBe('`<${a}|${b}|${c}>`');
        }
      }
      for (const v of Object.values(e)) {
        if (v && typeof v === 'object' && 'e' in (v as object)) walk(v as Expr);
        if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object' && 'e' in x) walk(x as Expr);
      }
    };
    for (const fn of p.functions) walk(fn.body);
    expect({ checked, unchecked }).toEqual({ checked: 1, unchecked: 5 });
    const t = ok('export function f(a: string, b: number, c: boolean): string { return `<${a}|${b}|${c}>`; }');
    expect(t.instrumentedTs).toContain('__faithful.template("line 1: `<${a}|${b}|${c}>`", "<", a, "|", b, "|", c, ">")');
    const run = new Function(`return ${buildInstrumentedRunner(t)}`)() as (a: Val[]) => Outcome;
    expect(run(['x', -3, true])).toEqual({ tag: 'ok', value: '<x|-3|true>' });
  });
});

describe('module scan and builtin names (red-team round 2)', () => {
  it('accepts inert module-level statements', () => {
    const t = ok(`'use strict';
import type { X } from './x';
type T = number;
interface I { a: T }
declare const env: string;
declare global { interface Math { extra(): number } }
namespace N { export type U = string }
const K = -3, S = 'a';
const T2 = \`a\${1 + 2}\`;
const g = (x: number): number => x;
const table = { a: 1, b: [2, 3], h: (y: number): number => y, get z(): number { return 1; } };
enum E { A = 1, B = 2 }
function helper(): void { Math.floor = (x: number): number => x; }
export { helper };
export default g;
export function f(x: number): number { return Math.floor(x / 2) + K; }`);
    expect(t.lean.source).toContain('Int.fdiv');
  });
  it('a module-level binding named undefined is not the undefined value', () => {
    const t = ok('const undefined = 5;\nexport function f(a: number): number | undefined { return undefined; }');
    expect(t.lean.source).toContain('some (5 : Int)');
    const g = ok('export function f(a: number): number | undefined { return a > 0 ? a : undefined; }');
    expect(g.lean.source).toContain('none');
  });
  it('a module-level Error binding is not the builtin Error', () => {
    // a hoisted function declaration passes the module scan; `Error("neg")` then calls the user's function (JS throws 1)
    const r = translate('function Error(message: string): number { return 1; }\nexport function f(a: number): number { if (a < 0) throw Error("neg"); return a; }', 'f');
    expect(r.ok ? 'ok' : `${r.refusal.code}: ${r.refusal.reason}`).toMatch(/^unsupported-syntax: only `throw new Error/);
    expect(ok('export function f(a: number): number { if (a < 0) throw new Error("neg"); return a; }').canThrow).toBe(true);
  });
  it('leanIdent never returns an empty identifier', () => {
    expect(leanIdent('')).toBe('v');
    const t = ok('type R = { "": number; v: number };\nexport function f(r: R): R { return { "": r.v, v: r[""] }; }');
    expect(t.lean.records![0]!.fields.map((x) => [x.name, x.lean])).toEqual([['', 'v'], ['v', 'v_']]);
  });
});

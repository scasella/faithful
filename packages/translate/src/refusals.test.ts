import { describe, expect, it } from 'vitest';
import { REFUSAL_CODES, refusalStats, translate } from './index.js';
import type { RefusalCode, TranslationResult } from './contracts.js';

/** Each case: source, function, expected code, and the exact source text the span must cover. */
const CASES: Array<{ code: RefusalCode; src: string; fn?: string; span: string; why?: RegExp }> = [
  { code: 'float', src: 'export function f(a: number): number { return a / 2; }', span: 'a / 2' },
  { code: 'float', src: 'export function f(a: number): number { return Math.sqrt(a); }', span: 'Math.sqrt' },
  { code: 'float', src: 'export function f(a: number): number { return a + 1.5; }', span: '1.5' },
  { code: 'float', src: 'export function f(a: number): number { return Math.floor(a / 2 + 1); }', span: 'a / 2' },
  { code: 'float', src: 'export function f(a: number): number { return Math.round(a); }', span: 'Math.round' },
  { code: 'regex', src: 'export function f(s: string): boolean { return /a+/.test(s); }', span: '/a+/' },
  { code: 'regex', src: 'export function f(r: RegExp): boolean { return true; }', span: 'RegExp' },
  { code: 'date', src: 'export function f(): number { return Date.now(); }', span: 'Date' },
  { code: 'map-set', src: 'export function f(x: number): number { const m = new Map<number, number>(); return x; }', span: 'Map' },
  { code: 'map-set', src: 'export function f(s: Set<number>): number { return 1; }', span: 'Set<number>' },
  { code: 'dictionary', src: 'export function f(d: Record<string, number>): number { return 1; }', span: 'Record<string, number>' },
  { code: 'dictionary', src: 'export function f(d: { [k: string]: number }): number { return 1; }', span: '{ [k: string]: number }' },
  { code: 'nan', src: 'export function f(a: number): number { return a > 0 ? a : NaN; }', span: 'NaN' },
  { code: 'nan', src: 'export function f(a: number): boolean { return Number.isNaN(a); }', span: 'Number.isNaN' },
  { code: 'io', src: 'export function f(a: number): number { console.log(a); return a; }', span: 'console' },
  { code: 'random', src: 'export function f(a: number): number { return a + Math.floor(Math.random()); }', span: 'Math.random' },
  { code: 'async', src: 'export async function f(a: number): Promise<number> { return a; }', span: 'async' },
  { code: 'async', src: 'export function f(a: number): number { const p = Promise.resolve(a); return a; }', span: 'Promise' },
  { code: 'generic', src: 'export function f<T>(a: T): T { return a; }', span: 'T' },
  { code: 'generic', src: 'export function f(xs: number[]): number { return xs.reduce<number>((a, x) => a + x, 0); }', span: 'number' },
  { code: 'bitwise', src: 'export function f(a: number): number { return a | 0; }', span: '|' },
  { code: 'bitwise', src: 'export function f(a: number): number { return ~a; }', span: '~a' },
  { code: 'this', src: 'export function f(this: { x: number }, a: number): number { return a; }', span: 'this: { x: number }' },
  { code: 'this', src: 'export function f(a: number): number { const g = () => a; return a; }\nexport const h = function (a: number): number { return (this as any).x; };', fn: 'h', span: 'this' },
  // red-team round 3: a callback's `this` pseudo-parameter (erased by TypeScript) must not shift the positional binding
  { code: 'this', src: 'export function f(xs: number[]): number[] { return xs.map(function (this: number, x: number): number { return x; }); }', span: 'this: number', why: /takes no argument position/ },
  { code: 'this', src: 'export function f(xs: number[]): number { return xs.reduce(function (this: number, a: number, x: number): number { return a + x; }, 0); }', span: 'this: number' },
  { code: 'this', src: 'export function f(xs: number[]): number[] { return xs.slice().sort(function (this: void, b: number): number { return b; }); }', span: 'this: void' },
  // a `this`-only callback is accepted (it ignores its arguments), but the body still cannot read `this`
  { code: 'this', src: 'export function f(xs: number[]): number[] { return xs.map(function (this: number): number { return this; }); }', span: 'this' },
  { code: 'mutable-capture', src: 'let counter = 0;\nexport function f(a: number): number { return a + counter; }', span: 'counter' },
  {
    code: 'mutable-capture',
    src: 'export function f(xs: number[]): number[] { let k = 1; k = k + 1; return xs.map((x) => x * k); }',
    span: 'k',
    why: /closure over mutable state/,
  },
  {
    code: 'mutable-capture',
    src: 'export function f(xs: number[]): number { let s = 0; const ys = xs.map((x) => { s = s + x; return x; }); return s; }',
    span: 's',
  },
  { code: 'no-termination-measure', src: 'export function f(x: number): number { while (x !== 0) { x = x - 1; } return x; }', span: 'x !== 0' },
  {
    code: 'no-termination-measure',
    src: 'export function fact(n: number): number { if (n === 0) return 1; return n * fact(n - 1); }',
    fn: 'fact',
    span: 'fact(n - 1)',
    why: /n === 0/,
  },
  {
    code: 'no-termination-measure',
    src: 'export function f(n: number): number { let i = 0; let s = 0; while (i < n) { if (s > 3) continue; s++; i++; } return s; }',
    span: 'i < n',
  },
  { code: 'no-termination-measure', src: 'export function f(n: number): number { for (let i = 0; ; i++) { if (i > n) return i; } }', span: 'for (let i = 0; ; i++) { if (i > n) return i; }' },
  { code: 'unsupported-type', src: 'export function f(x: any): number { return 1; }', span: 'any' },
  { code: 'unsupported-type', src: 'export function f(x: number | string): number { return 1; }', span: 'number | string' },
  { code: 'unsupported-type', src: 'export function f(x: number | null): number { return 1; }', span: 'number | null' },
  { code: 'unsupported-syntax', src: 'export function f(x: number): number { switch (x) { default: return 1; } }', span: 'switch (x) { default: return 1; }' },
  { code: 'unsupported-syntax', src: 'function g(x: number): number { return x; }\nexport function f(x: number): number { return g(x); }', span: 'g(x)', why: /calls to other functions/ },
  { code: 'unsupported-syntax', src: 'export function f(xs: number[], ys: number[]): boolean { return xs === ys; }', span: 'xs === ys', why: /references/ },
  { code: 'unsupported-syntax', src: 'export function f(x: number): boolean { return x ? true : false; }', span: 'x', why: /truthiness/ },
  { code: 'unsupported-syntax', src: 'export function f(xs: number[]): number[] { return xs.sort((a, b) => a - b); }', span: 'xs.sort((a, b) => a - b)', why: /mutates/ },
  { code: 'unsupported-syntax', src: 'export function f(xs: number[]): number[] { return xs.slice().sort(); }', span: 'xs.slice().sort()', why: /as strings/ },
  { code: 'unsupported-syntax', src: 'export function f(x: number): number { return x as number; }', span: 'x as number' },
  { code: 'unsupported-library', src: 'export function f(xs: number[]): number[] { xs.push(1); return xs; }', span: 'xs.push(1)' },
  { code: 'unsupported-library', src: 'export function f(s: string): string { return s.trim(); }', span: 'trim' },
  { code: 'unsupported-library', src: 'export function f(s: string): number { return parseInt(s); }', span: 'parseInt(s)' },
  { code: 'missing-annotation', src: 'export function f(x): number { return 1; }', span: 'x' },
  { code: 'missing-annotation', src: 'export function f(x: number) { return x; }', span: 'f' },
  { code: 'missing-annotation', src: 'export function f(x: number): number[] { const out = []; return out; }', span: 'out = []' },
  { code: 'non-bmp', src: 'export function f(s: string): string { return s + "😀"; }', span: '"😀"' },
  { code: 'non-bmp', src: 'export function f(s: string): string { return s + "\\uD800"; }', span: '"\\uD800"' },
  { code: 'not-found', src: 'export function f(x: number): number { return x; }', fn: 'nope', span: '' },
  { code: 'not-found', src: 'function g(x: number): number { return x; }', fn: 'g', span: 'g' },
  // red-team round 2: module-level code that runs at load time (mathFloorPatched), and shadowed builtins (moduleMathShadow)
  {
    code: 'unsupported-syntax',
    src: 'Math.floor = (x: number): number => x;\nexport function f(a: number, b: number): number { return Math.floor(a / b); }',
    span: 'Math.floor = (x: number): number => x;',
    why: /module loads/,
  },
  { code: 'unsupported-syntax', src: 'import "./setup";\nexport function f(x: number): number { return x; }', span: 'import "./setup";', why: /module loads/ },
  { code: 'unsupported-syntax', src: 'class C { static n = 1; }\nexport function f(x: number): number { return x; }', span: 'class C { static n = 1; }', why: /module loads/ },
  { code: 'unsupported-syntax', src: 'const { a } = { a: 1 };\nexport function f(x: number): number { return x; }', span: 'const { a } = { a: 1 };', why: /module loads/ },
  { code: 'unsupported-syntax', src: 'const k = String(1);\nexport function f(x: number): number { return x; }', span: 'const k = String(1);', why: /module loads/ },
  { code: 'unsupported-syntax', src: 'const o = { valueOf: (): number => 1 };\nconst k = +o;\nexport function f(x: number): number { return x; }', span: 'const k = +o;', why: /module loads/ },
  {
    code: 'mutable-capture',
    src: 'const Math = { floor: (x: number): number => x };\nexport function f(a: number, b: number): number { return Math.floor(a / b); }',
    span: 'Math',
    why: /module-level state/,
  },
  { code: 'unsupported-type', src: 'type R = { __proto__: number; a: number };\nexport function f(r: R): number { return r.a; }', span: 'R', why: /__proto__/ },
];

function check(r: TranslationResult, src: string, code: RefusalCode, span: string, why?: RegExp): void {
  if (r.ok) throw new Error(`expected refusal ${code}, got a translation`);
  expect(r.refusal.code, r.refusal.reason).toBe(code);
  expect(src.slice(r.refusal.span.start, r.refusal.span.end)).toBe(span);
  // line/column are 1-based and agree with start
  const before = src.slice(0, r.refusal.span.start);
  expect(r.refusal.span.line).toBe(before.split('\n').length);
  expect(r.refusal.span.column).toBe(before.length - before.lastIndexOf('\n'));
  expect(r.refusal.reason.length).toBeGreaterThan(10);
  if (why) expect(r.refusal.reason).toMatch(why);
}

describe('refusals', () => {
  for (const c of CASES) {
    it(`${c.code}: ${c.src.replace(/\s+/g, ' ').slice(0, 80)}`, () => {
      check(translate(c.src, c.fn ?? 'f'), c.src, c.code, c.span, c.why);
    });
  }

  it('covers every RefusalCode', () => {
    const covered = new Set(CASES.map((c) => c.code));
    for (const code of REFUSAL_CODES) expect(covered.has(code), code).toBe(true);
    expect(REFUSAL_CODES).toHaveLength(20);
  });

  it('the first, most fundamental refusal wins', () => {
    // signature (missing annotation) before body features (regex)
    const a = 'export function f(x): boolean { return /a/.test("a"); }';
    check(translate(a, 'f'), a, 'missing-annotation', 'x');
    // body features in source order
    const b = 'export function f(x: number): number { console.log(x); return x | 0; }';
    check(translate(b, 'f'), b, 'io', 'console');
    const c = 'export function f(x: number): number { const y = x | 0; console.log(y); return y; }';
    check(translate(c, 'f'), c, 'bitwise', '|');
    // feature scan before lowering (no-termination-measure)
    const d = 'export function f(x: number): number { while (x !== 0) { x = x - 1; } return Math.floor(Math.random()); }';
    check(translate(d, 'f'), d, 'random', 'Math.random');
    // not-found before everything
    const e = 'export function f(x): number { return x; }';
    check(translate(e, 'g'), e, 'not-found', '');
  });

  it('refuses a function that does not type-check', () => {
    const src = 'export function f(x: number): number { const s: string = x; return 1; }';
    const r = translate(src, 'f');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe('unsupported-syntax');
      expect(r.refusal.reason).toMatch(/type-check: TS2322/);
      expect(src.slice(r.refusal.span.start, r.refusal.span.end)).toBe('s');
    }
  });

  // red-team round 4: comments that hide diagnostics, and module constants that do not type-check
  it('refuses TypeScript comment directives that can hide an error of the function or of a constant it reads', () => {
    const refused: Array<[string, string]> = [
      ['export function f(n: number): number {\n  // @ts-ignore\n  return n;\n}', '// @ts-ignore'],
      // trailing comment on a code line (TypeScript calls it a trailing comment of the previous token)
      ['export function f(xs: number[]): number {\n  const ys = xs; return ys.length; // @ts-expect-error\n}', '// @ts-expect-error'],
      ['export function f(n: number): number { /** @ts-ignore */ return n; }', '/** @ts-ignore */'],
      // the comment belongs to the previous statement but suppresses the line on which `f` starts
      ['function g(): number { return 1; // @ts-ignore\n} export function f(n: number): { a: number; b: number }[] { return [{ a: n, a: n + 1 }]; }', '// @ts-ignore'],
      ['// @ts-nocheck\nexport function f(n: number): number { return n; }', '// @ts-nocheck'],
      ['// @ts-ignore\nconst K = 1;\nexport function f(n: number): number { return n + K; }', '// @ts-ignore'],
      ['const K = 010;\nexport function f(n: number): number { return n + K; }', '010'],
      ['const K = 1__0;\nexport function f(n: number): number { return n + K; }', '_'],
      ['const S = "a\\1b";\nexport function f(n: number): number { return S.length + n; }', '\\1'],
    ];
    for (const [src, span] of refused) {
      const r = translate(src, 'f');
      expect(r.ok, src).toBe(false);
      if (!r.ok) {
        expect(r.refusal.code, src).toBe('unsupported-syntax');
        expect(src.slice(r.refusal.span.start, r.refusal.span.end), src).toBe(span);
      }
    }
    // not a comment, or a directive that cannot reach the function or a constant it reads
    for (const src of [
      'export function f(n: number): string { return "// @ts-ignore" + n; }',
      '// @ts-ignore\nconst Z = 1;\nexport function f(n: number): number { return n + 1; }',
      'const Z = 010;\nexport function f(n: number): number { return n + 1; }',
    ])
      expect(translate(src, 'f').ok, src).toBe(true);
  });

  it('refusalStats counts every code', () => {
    const results = CASES.map((c) => translate(c.src, c.fn ?? 'f'));
    results.push(translate('export function f(x: number): number { return x; }', 'f'));
    const s = refusalStats(results);
    expect(Object.keys(s).sort()).toEqual([...REFUSAL_CODES].sort());
    for (const code of REFUSAL_CODES) expect(s[code]).toBe(CASES.filter((c) => c.code === code).length);
  });
});

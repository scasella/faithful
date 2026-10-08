import vm from 'node:vm';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Val } from '@faithful/translate';
import { extractUnit } from './extract.js';
import { Sandbox } from './sandbox.js';
import { moduleProblems, prepareSource } from './source.js';

interface Case {
  name: string;
  src: string;
  fn: string;
  /** Expected included names, in order (ok cases). */
  included?: string[];
  /** Expected refusal reason (refused cases). */
  refused?: RegExp;
  /** Call sequences for the equivalence probe (each list is run in order on one fresh load). */
  calls?: Val[][];
  /** The whole file loads in the sandbox (so the equivalence probe compares unit vs file). */
  wholeLoads?: boolean;
}

const CASES: Case[] = [
  {
    name: 'unrelated value import elsewhere in the file: now runnable',
    src: `import { readFileSync } from 'node:fs';\nexport function other(p: string): string { return readFileSync(p, 'utf8'); }\nexport function add(a: number, b: number): number { return a + b; }\n`,
    fn: 'add',
    included: [],
    calls: [[1, 2], [-3, 0.5]],
    wholeLoads: false,
  },
  {
    name: 'function using an imported helper: refused, names the import',
    src: `import { clamp } from './util';\nexport function f(x: number): number { return clamp(x, 0, 1); }\n`,
    fn: 'f',
    refused: /it uses clamp, imported from '\.\/util'/,
  },
  {
    name: 'function reading a module const: included',
    src: `const K = 3;\nexport function f(x: number): number { return x * K; }\n`,
    fn: 'f',
    included: ['K'],
    calls: [[2], [-1.5]],
    wholeLoads: true,
  },
  {
    name: 'const referencing another const: transitive, original order',
    src: `const A = 2;\nconst UNUSED = 99;\nconst B = A * 10;\nexport function f(x: number): number { return x + B; }\n`,
    fn: 'f',
    included: ['A', 'B'],
    calls: [[1]],
    wholeLoads: true,
  },
  {
    name: 'shadowed names, parameters, locals and properties do not pull declarations in',
    src: `const n = 100;\nconst xs = [1];\nconst key = 'k';\nexport function f(n: number): number { const xs = [n]; const o = { key: 1, n }; return xs[0]! + o.n + o.key; }\n`,
    fn: 'f',
    included: [],
    calls: [[4]],
    wholeLoads: true,
  },
  {
    name: 'type-only import not used by the function: dropped',
    src: `import type { Foo } from './foo';\nexport function g(f: Foo): Foo { return f; }\nexport function f(x: number): number { return x; }\n`,
    fn: 'f',
    included: [],
    calls: [[7]],
    wholeLoads: true,
  },
  {
    name: 'type-only import used in the signature: refused',
    src: `import type { Foo } from './foo';\nexport function f(x: Foo): number { return 1; }\n`,
    fn: 'f',
    refused: /the types it uses include Foo, imported from '\.\/foo'/,
  },
  {
    name: 'referenced local types are kept',
    src: `interface P { x: number; y: number }\ntype Q = P & { z: number };\nexport function f(q: Q): number { return q.x + q.y + q.z; }\n`,
    fn: 'f',
    included: ['P', 'Q'],
    calls: [[{ x: 1, y: 2, z: 3 }]],
    wholeLoads: true,
  },
  {
    name: 'function calling other functions in the file: transitive, order preserved',
    src: `function b(x: number): number { return c(x) * 2; }\nfunction unused(): number { return 0; }\nfunction c(x: number): number { return x + 1; }\nexport function a(x: number): number { return b(x); }\n`,
    fn: 'a',
    included: ['b', 'c'],
    calls: [[3]],
    wholeLoads: true,
  },
  {
    name: 'recursion',
    src: `export function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\n`,
    fn: 'fib',
    included: [],
    calls: [[10]],
    wholeLoads: true,
  },
  {
    name: 'reading `const live = new Set<Worker>()` (mutated only inside other functions): included',
    src: `const live = new Set<string>();\nexport function track(s: string): void { live.add(s); }\nexport function count(): number { return live.size; }\nclass Pool { add(w: string) { live.add(w); } }\n`,
    fn: 'count',
    included: ['live'],
    calls: [[], []],
    wholeLoads: true,
  },
  {
    name: 'dropped top-level call of a function that mutates an included binding: refused',
    src: `const live = new Set<string>();\nfunction track(s: string): void { live.add(s); }\ntrack('boot');\nexport function count(): number { return live.size; }\n`,
    fn: 'count',
    refused: /module-level code outside the function \(line 2\) calls a method of live/,
  },
  {
    name: 'dropped top-level `counter++` on an included binding: refused',
    src: `let counter = 0;\ncounter++;\nexport function get(): number { return counter; }\n`,
    fn: 'get',
    refused: /module-level code outside the function \(line 2\) changes counter, which the function reads/,
  },
  {
    name: 'dropped `registry.set(...)` on an included binding: refused',
    src: `const registry = new Map<string, number>();\nregistry.set('a', 1);\nexport function look(k: string): number { return registry.get(k) ?? -1; }\n`,
    fn: 'look',
    refused: /calls a method of registry/,
  },
  {
    name: 'dropped alias of an included binding (escape): refused',
    src: `const reg: number[] = [];\nconst alias = reg;\nalias.push(1);\nexport function f(): number { return reg.length; }\n`,
    fn: 'f',
    refused: /passes on reg/,
  },
  {
    name: 'dropped plain reads of an included binding: fine',
    src: `const TABLE = [1, 2, 3];\nconst n = TABLE.length;\nif (TABLE.length > 2) { /* nothing */ }\nexport function f(i: number): number { return TABLE[i] ?? -1; }\n`,
    fn: 'f',
    included: ['TABLE'],
    calls: [[0], [2], [5]],
    wholeLoads: true,
  },
  {
    name: 'dropped unrelated side effects (ambient globals, a throw): fine',
    src: `console.log('loading');\nconst t = Date.now();\nif (t > 0) throw new Error('boom at load');\nexport function f(x: number): number { return x * 2; }\n`,
    fn: 'f',
    included: [],
    calls: [[21]],
    wholeLoads: false,
  },
  {
    name: 'top-level await in a declaration the function uses: refused',
    src: `const data = await Promise.resolve(3);\nexport function f(): number { return data; }\n`,
    fn: 'f',
    refused: /top-level await/,
  },
  {
    name: 'top-level await elsewhere: dropped',
    src: `const data = await Promise.resolve(3);\nexport function f(x: number): number { return x + 1; }\n`,
    fn: 'f',
    included: [],
    calls: [[1]],
    wholeLoads: false,
  },
  {
    name: 'class referenced (self-contained static init): included',
    src: `class Acc { static base = 10; total(xs: number[]): number { return xs.reduce((s, x) => s + x, Acc.base); } }\nexport function f(xs: number[]): number { return new Acc().total(xs); }\n`,
    fn: 'f',
    included: ['Acc'],
    calls: [[[1, 2, 3]], [[]]],
    wholeLoads: true,
  },
  {
    name: 'enum referenced: included',
    src: `enum Color { Red = 1, Green = 2 }\nexport function f(x: number): string { return x === Color.Red ? 'red' : x === Color.Green ? 'green' : 'other'; }\n`,
    fn: 'f',
    included: ['Color'],
    calls: [[1], [2], [3]],
    wholeLoads: true,
  },
  {
    name: 'destructured const: the whole statement and its source',
    src: `const cfg = { a: 2, b: 3 };\nconst { a, b } = cfg;\nexport function f(x: number): number { return x * a + b; }\n`,
    fn: 'f',
    included: ['cfg', 'a', 'b'],
    calls: [[5]],
    wholeLoads: true,
  },
  {
    name: '`let` reassigned by an included function: allowed (fully inside the closure)',
    src: `let calls = 0;\nfunction bump(): number { calls++; return calls; }\nexport function f(x: number): number { return x + bump(); }\n`,
    fn: 'f',
    included: ['calls', 'bump'],
    calls: [[1], [1], [1]],
    wholeLoads: true,
  },
  {
    name: '`export default function`: target',
    src: `export default function inc(x: number): number { return x + 1; }\n`,
    fn: 'inc',
    included: [],
    calls: [[1]],
    wholeLoads: true,
  },
  {
    name: '`export default { f }` with no mutable state: dropped',
    src: `const K = 2;\nexport function f(x: number): number { return x * K; }\nexport default { f };\n`,
    fn: 'f',
    included: ['K'],
    calls: [[4]],
    wholeLoads: false,
  },
  {
    name: '`export default { f }` when the closure holds state: refused',
    src: `const cache = new Map<number, number>();\nexport function f(x: number): number { if (!cache.has(x)) cache.set(x, x * 2); return cache.get(x)!; }\nexport default { f };\n`,
    fn: 'f',
    refused: /passes the function itself on while the file loads; that may change state the function reads/,
  },
  {
    name: 'non-exported function: the unit exports it',
    src: `function f(x: number): number { return -x; }\nexport const g = 1;\n`,
    fn: 'f',
    included: [],
    calls: [[3]],
    wholeLoads: true,
  },
  {
    name: 'arrow function in a const: refused with a reason',
    src: `export const f = (x: number): number => x + 1;\n`,
    fn: 'f',
    refused: /stored in a variable; the Tested tier runs only function declarations/,
  },
  {
    name: 'trapped global in a load-time initializer the function uses: refused',
    src: `const started = performance.now();\nexport function f(): number { return started; }\n`,
    fn: 'f',
    refused: /reads performance when the file loads/,
  },
  {
    name: 'dynamic import() inside the function: refused',
    src: `export function f(): unknown { return import('./x'); }\n`,
    fn: 'f',
    refused: /import\(\)/,
  },
  {
    name: 'dynamic import() elsewhere: dropped',
    src: `export function g(): unknown { return import('./x'); }\nexport function f(x: number): number { return x; }\n`,
    fn: 'f',
    included: [],
    calls: [[1]],
    wholeLoads: false,
  },
  {
    name: 'namespace referenced: refused',
    src: `namespace N { export const k = 1; }\nexport function f(): number { return N.k; }\n`,
    fn: 'f',
    refused: /namespace N/,
  },
  {
    name: '`declare const` referenced: refused',
    src: `declare const __VERSION__: string;\nexport function f(): string { return __VERSION__; }\n`,
    fn: 'f',
    refused: /only declares/,
  },
  {
    name: 're-exports and `export =` elsewhere: dropped',
    src: `export * from './other';\nexport { x } from './y';\nexport function f(x: number): number { return x + 2; }\n`,
    fn: 'f',
    included: [],
    calls: [[0]],
    wholeLoads: false,
  },
  {
    name: 'overloaded target: refused (the patch and the inputs are built for one declaration), whole file too',
    src: `export function f(x: number): number;\nexport function f(x: number): number { return x * 3; }\n`,
    fn: 'f',
    refused: /f is overloaded \(1 signature before the implementation\); the Tested tier does not run overloaded functions yet/,
  },
  // --- precision: an alias of `eval` / `Function`, and a function only STORED in the default export (rule 5) ---
  {
    name: 'dropped `const e = eval;` that nothing at load uses: extracted (an alias only reads a global)',
    src: `const e = eval;\nconst K = 3;\nexport function f(x: number): number { return x * K; }\n`,
    fn: 'f',
    included: ['K'],
    calls: [[2], [-1.5]],
    wholeLoads: true,
  },
  {
    name: 'dropped `const RealFunction = Function;` that nothing at load uses: extracted (rule 5 used to refuse it)',
    src: `const RealFunction = Function;\nconst K = 3;\nexport function f(x: number): number { return x * K; }\n`,
    fn: 'f',
    included: ['K'],
    calls: [[2]],
    wholeLoads: true,
  },
  {
    name: 'dropped `const e = eval;` used by a dropped function that nothing calls at load: extracted',
    src: `const e = eval;\nfunction run(s: string): unknown { return e(s); }\nexport function f(x: number): number { return x + 1; }\n`,
    fn: 'f',
    included: [],
    calls: [[4]],
    wholeLoads: true,
  },
  {
    name: 'a dropped alias of `eval` that load-time code runs: refused (the string has no syntactic link to what it changes)',
    src: `const cfg = { k: 1 };\nconst e = eval;\ne('cfg.k = 100');\nexport function f(n: number): number { return n + cfg.k; }\n`,
    fn: 'f',
    refused: /module-level code outside the function \(line 3\) uses e, which is another name for eval: it runs code from a string/,
  },
  {
    name: 'a dropped alias of `Function` that load-time code constructs with: refused',
    src: `const cfg = { k: 1 };\nconst RF = Function;\nnew RF('cfg.k = 100')();\nexport function f(n: number): number { return n + cfg.k; }\n`,
    fn: 'f',
    refused: /uses RF, which is another name for Function/,
  },
  {
    name: 'a dropped alias of `Function` used by a dropped function that load-time code calls: refused',
    src: `const cfg = { k: 1 };\nconst RF = Function;\nfunction boot(): void { new RF('cfg.k = 100')(); }\nboot();\nexport function f(n: number): number { return n + cfg.k; }\n`,
    fn: 'f',
    refused: /uses RF, which is another name for Function/,
  },
  {
    name: 'a dropped alias of `eval` used by a dropped arrow that load-time code calls: refused',
    src: `const cfg = { k: 1 };\nconst e = eval;\nconst run = () => e('cfg.k = 100');\nrun();\nexport function f(n: number): number { return n + cfg.k; }\n`,
    fn: 'f',
    refused: /uses e, which is another name for eval/,
  },
  {
    name: 'direct eval in the function: refused (it can read names the unit leaves out)',
    src: `export function f(s: string): unknown { return eval(s); }\n`,
    fn: 'f',
    refused: /it calls eval, which can read any name in the file/,
  },
  {
    name: 'direct eval written with parentheses or a cast: still refused',
    src: `export function f(s: string): unknown { return (eval as any)(s); }\n`,
    fn: 'f',
    refused: /it calls eval, which can read any name in the file/,
  },
  {
    name: 'indirect eval `(0, eval)(s)` sees only the global scope: extracted (the sandbox traps it when it runs)',
    src: `export function f(s: string): unknown { return (0, eval)(s); }\n`,
    fn: 'f',
    included: [],
  },
  {
    name: 'a function in the closure that uses an alias of `Function`: the alias is included, and rule 3 refuses it',
    src: `const RealFunction = Function;\nexport function f(s: string): unknown { return new RealFunction(s)(); }\n`,
    fn: 'f',
    refused: /a declaration it uses reads Function when the file loads/,
  },
  {
    name: '`export default { helper }` where helper (dropped) changes included state when CALLED: extracted, with the caveat',
    src: `const cfg = { k: 1 };\nfunction helper(): void { cfg.k = 100; }\nexport function f(n: number): number { return n + cfg.k; }\nexport default { helper };\n`,
    fn: 'f',
    included: ['cfg'],
    calls: [[1], [2]],
    wholeLoads: false,
  },
  {
    name: '`export default helper;` and nested literals only store: extracted',
    src: `const cfg = { k: 1 };\nfunction helper(): void { cfg.k = 100; }\nclass Box { put(): void { cfg.k = 5; } }\nexport function f(n: number): number { return n + cfg.k; }\nexport default { a: { b: [helper, Box] }, helper };\n`,
    fn: 'f',
    included: ['cfg'],
    calls: [[1]],
    wholeLoads: false,
  },
  {
    name: 'a dropped function referenced by an object bound to a name that load-time code uses: refused (not only stored)',
    src: `const cfg = { k: 1 };\nfunction bump(): void { cfg.k = 100; }\nconst api = { bump };\napi.bump();\nexport function f(n: number): number { return n + cfg.k; }\n`,
    fn: 'f',
    refused: /module-level code outside the function \(line 2\) changes cfg, which the function reads/,
  },
  {
    name: '`export default [helper].map(...)` calls it at load: refused',
    src: `const cfg = { k: 1 };\nfunction bump(): number { cfg.k = 100; return 1; }\nexport function f(n: number): number { return n + cfg.k; }\nexport default [bump].map((g) => g());\n`,
    fn: 'f',
    refused: /changes cfg, which the function reads/,
  },
  {
    name: '`export default { v: helper() }` calls it at load: refused',
    src: `const cfg = { k: 1 };\nfunction bump(): number { cfg.k = 100; return 1; }\nexport function f(n: number): number { return n + cfg.k; }\nexport default { v: bump() };\n`,
    fn: 'f',
    refused: /changes cfg, which the function reads/,
  },
];

describe('extractUnit: rules', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const r = extractUnit(c.src, c.fn);
      if (c.refused) {
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.reason).toMatch(c.refused);
          expect(r.reason).not.toMatch(/SyntaxKind|undefined|\[object/);
        }
        return;
      }
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(r.included.map((d) => d.name)).toEqual(c.included);
      // never widens what the sandbox allows: the unit prepares, and carries no module syntax at all
      const prep = prepareSource(r.unit);
      expect(prep, JSON.stringify(prep)).toMatchObject({ ok: true });
      const sf = ts.createSourceFile('u.ts', r.unit, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      expect(moduleProblems(sf)).toEqual([]);
      expect(sf.statements.some((s) => ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s) || ts.isExportAssignment(s) || (ts.isExportDeclaration(s) && !!s.moduleSpecifier))).toBe(false);
      // every statement of the unit is a statement of the original, in order (only `export ` may be added)
      let from = 0;
      for (const st of sf.statements) {
        const text = st.getText(sf).replace(/^export /, '');
        const at = c.src.indexOf(text, from);
        expect(at, text).toBeGreaterThanOrEqual(0);
        from = at + text.length;
      }
    });
  }

  it('included state changed by code that does not run at load: extracted, with a caveat naming the lines', () => {
    const src = `const live = new Set<string>();\nexport function track(s: string): void { live.add(s); }\nexport function count(): number { return live.size; }\nclass Pool { add(w: string) { live.add(w); } }\n`;
    const r = extractUnit(src, 'count');
    expect(r).toMatchObject({ ok: true, caveats: ['other code in this file (lines 2, 4) can change live when it is called; nothing in the file calls it while the file loads and the comparison never called it, so the comparison saw only the starting value of live'] });
    // nothing else touches it: no caveat
    expect(extractUnit(`const K = [1, 2];\nexport function f(i: number): number { return K[i] ?? 0; }\n`, 'f')).toMatchObject({ ok: true, caveats: [] });
    // a primitive const can never change: no caveat even when other code reads it
    expect(extractUnit(`const K = 2;\nexport function g(): number { return K * 2; }\nexport function f(): number { return K; }\n`, 'f')).toMatchObject({ ok: true, caveats: [] });
  });

  it('lines in `included` are the lines of the original', () => {
    const r = extractUnit(`// header\n\nconst A = 1;\nconst B = A + 1;\nexport function f(): number { return B; }\n`, 'f');
    expect(r).toMatchObject({ ok: true, included: [{ kind: 'const', name: 'A', line: 3 }, { kind: 'const', name: 'B', line: 4 }], lineMap: [3, 4, 5] });
    const doc = extractUnit(`const A = 1;\n\n/**\n * doc\n */\nfunction f(): number {\n  return A;\n}\n`, 'f');
    expect(doc).toMatchObject({ ok: true, lineMap: [1, 3, 4, 5, 6, 7, 8] });
    if (doc.ok) expect(doc.unit).toBe('const A = 1;\n/**\n * doc\n */\nexport function f(): number {\n  return A;\n}\n');
  });

  it('refusals carry the position of the offending reference', () => {
    const r = extractUnit(`import { h } from './h';\nexport function f(x: number): number {\n  return h(x);\n}\n`, 'f');
    expect(r).toMatchObject({ ok: false, line: 3, column: 10 });
  });

  it('missing function', () => {
    expect(extractUnit(`export const x = 1;\n`, 'nope')).toMatchObject({ ok: false, reason: 'no function declaration named nope with a body was found' });
  });
});

describe('extractUnit: equivalence probe (unit vs whole file in the sandbox)', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });

  for (const c of CASES.filter((x) => !x.refused && x.calls)) {
    it(c.name, async () => {
      const r = extractUnit(c.src, c.fn);
      if (!r.ok) throw new Error(r.reason);
      const u = await sb.load(`u:${c.name}`, r.unit, c.fn, { values: 'js' });
      expect(u, JSON.stringify(u)).toMatchObject({ ok: true });
      const w = await sb.load(`w:${c.name}`, c.src, c.fn, { values: 'js' });
      expect(w.ok).toBe(!!c.wholeLoads);
      const unitOut = [];
      for (const args of c.calls!) unitOut.push((await sb.call(`u:${c.name}`, args)).outcome);
      expect(unitOut.every((o) => o.tag === 'ok' || o.tag === 'throw')).toBe(true);
      if (w.ok) {
        const wholeOut = [];
        for (const args of c.calls!) wholeOut.push((await sb.call(`w:${c.name}`, args)).outcome);
        expect(unitOut).toEqual(wholeOut);
      }
      await sb.unload(`u:${c.name}`);
      await sb.unload(`w:${c.name}`).catch(() => undefined);
    });
  }
});

/**
 * Review reproductions (soundness guard, rule 5): each shape either REFUSES, or the extracted unit behaves exactly like
 * the whole file in the sandbox. A shape whose whole file does not load must be refused (nothing to compare with).
 */
const F = `export function f(n: number): number { return n + cfg.k; }\n`;
const CFG = `const cfg = { k: 1 };\n`;
const GUARD_SHAPES: Array<{ name: string; src: string; mustRefuse?: boolean }> = [
  { name: 'IIFE (arrow) mutating included state', src: `${CFG}(() => { cfg.k = 100; })();\n${F}`, mustRefuse: true },
  { name: 'IIFE (function expression)', src: `${CFG}(function () { cfg.k = 100; })();\n${F}`, mustRefuse: true },
  { name: 'callback passed to a call at load', src: `${CFG}[1].forEach(() => { cfg.k = 100; });\n${F}`, mustRefuse: true },
  { name: 'let reassigned by an IIFE', src: `let k = 1;\n(() => { k = 100; })();\nexport function f(n: number): number { return n + k; }\n`, mustRefuse: true },
  { name: 'getter invoked at load', src: `${CFG}({ get g() { cfg.k = 100; return 1; } }).g;\n${F}`, mustRefuse: true },
  { name: 'anonymous class constructed at load', src: `${CFG}new (class { constructor() { cfg.k = 100; } })();\n${F}`, mustRefuse: true },
  { name: 'class computed method key', src: `${CFG}class D { [(cfg.k = 100, 'm')]() { return 1; } }\n${F}`, mustRefuse: true },
  { name: 'class computed field key', src: `${CFG}class D { [(cfg.k = 100, 'm')] = 0; }\n${F}`, mustRefuse: true },
  { name: 'object computed method key', src: `${CFG}const o = { [(cfg.k = 100, 'm')]() { return 1; } };\n${F}`, mustRefuse: true },
  { name: 'decorator mutating included state', src: `${CFG}function dec(t: any, c: any) { cfg.k = 100; }\nclass D { @dec m() { return 1; } }\n${F}`, mustRefuse: true },
  { name: 'static block calling a method through this', src: `${CFG}class D { static { this.prototype.m(); } m() { cfg.k = 100; } }\n${F}`, mustRefuse: true },
  { name: 'tagged template receives the object', src: `${CFG}function tag(s: TemplateStringsArray, o: any) { o.k = 100; return ''; }\ntag\`\${cfg}\`;\n${F}`, mustRefuse: true },
  { name: 'instanceof calls Symbol.hasInstance with the object', src: `${CFG}class X { static [Symbol.hasInstance](o: any) { o.k = 100; return true; } }\ncfg instanceof X;\n${F}`, mustRefuse: true },
  { name: 'arithmetic calls a user valueOf', src: `const cfg = { k: 1, valueOf(): number { this.k = 100; return 0; } };\ncfg + 1;\n${F}`, mustRefuse: true },
  { name: 'Object.defineProperty on an included function read through `as any`', src: `function h(): number { return 0; }\nObject.defineProperty(h, 'k', { value: 100 });\nexport function f(n: number): number { return n + ((h as any).k ?? 1); }\n`, mustRefuse: true },
  { name: 'Object.assign on an included function read through element access', src: `function helper(): number { return 0; }\nObject.assign(helper, { k: 100 });\nexport function f(n: number): number { return n + ((helper as any)['k'] ?? 1); }\n`, mustRefuse: true },
  { name: 'included function read through a local alias', src: `function helper(): number { return 0; }\nObject.defineProperty(helper, 'k', { value: 100 });\nexport function f(n: number): number { const h: any = helper; return n + (h.k ?? 1); }\n`, mustRefuse: true },
  { name: 'the target itself given a property', src: `Object.defineProperty(f, 'k', { value: 100 });\nexport function f(n: number): number { return n + ((f as any)['k'] ?? 1); }\n`, mustRefuse: true },
  { name: 'Array.prototype changed at load', src: `(Array.prototype as any).includes = function () { return true; };\nexport function f(n: number): number { return [1, 2].includes(n) ? 1 : 0; }\n`, mustRefuse: true },
  { name: 'built-in prototype reached through getPrototypeOf', src: `(Object.getPrototypeOf([]) as any).includes = function () { return true; };\nexport function f(n: number): number { return [1, 2].includes(n) ? 1 : 0; }\n`, mustRefuse: true },
  { name: 'built-in aliased then changed', src: `const AP: any = Array.prototype;\nAP.includes = function () { return true; };\nexport function f(n: number): number { return [1, 2].includes(n) ? 1 : 0; }\n`, mustRefuse: true },
  { name: 'Object.prototype reached through a dropped binding (__proto__)', src: `const o: any = {};\no.__proto__.k = 100;\nexport function f(n: number): number { return n + (({} as any).k ?? 1); }\n`, mustRefuse: true },
  { name: 'Array.prototype reached through a dropped binding (constructor.prototype)', src: `const a: any = [];\na.constructor.prototype.includes = () => true;\nexport function f(n: number): number { return [1, 2].includes(n) ? 1 : 0; }\n`, mustRefuse: true },
  { name: 'Object.assign on a built-in', src: `Object.assign(Math, { max: () => 0 });\nexport function f(n: number): number { return Math.max(n, 1); }\n`, mustRefuse: true },
  { name: 'direct eval at load', src: `${CFG}eval('cfg.k = 100');\n${F}`, mustRefuse: true },
  { name: 'Function from a string at load', src: `new Function('Array.prototype.includes = function () { return true; }')();\nexport function f(n: number): number { return [1, 2].includes(n) ? 1 : 0; }\n`, mustRefuse: true },
  { name: 'overloaded target', src: `export function f(n: number): number;\nexport function f(n: string): string;\nexport function f(n: any): any { return n + 0; }\n`, mustRefuse: true },
  { name: 'the target itself re-declared by a var in a block (refused out of caution: the module variable and the function are one name)', src: `if (true) { var f: any = () => 100; }\nexport function f(n: number): number { return n + 1; }\n`, mustRefuse: true },
  // still extracted (and equal):
  { name: 'plain-data reads at load stay allowed', src: `const TABLE = [1, 2, 3];\nconst n0 = TABLE.length + TABLE[0]!;\nconst s = \`\${TABLE}\`;\nexport function f(n: number): number { return n + (TABLE[1] ?? 0); }\n` },
  { name: 'arrow stored in a dropped const that is never called', src: `${CFG}export const reset = () => { cfg.k = 1; };\n${F}` },
  { name: 'dropped class whose method changes state (never constructed at load)', src: `${CFG}class Pool { bump() { cfg.k++; } }\n${F}` },
  { name: 'a dropped class extending a built-in (reads it, changes nothing)', src: `class Refuse extends Error {}\nexport function f(n: number): number { return n * 3; }\n` },
  { name: "a dropped class's own prototype changed at load (only that class)", src: `class Foo {}\n(Foo.prototype as any).m = () => 1;\nexport function f(n: number): number { return n * 3; }\n` },
  { name: 'unrelated top-level console use', src: `const log = console.log.bind(console);\nlog('x');\nconst PI = Math.PI;\nexport function f(n: number): number { return n * 2; }\n` },
];

describe('extractUnit: soundness guard (review reproductions)', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });
  for (const c of GUARD_SHAPES) {
    it(c.name, async () => {
      const r = extractUnit(c.src, 'f');
      if (c.mustRefuse) {
        expect(r, JSON.stringify(r)).toMatchObject({ ok: false });
        if (!r.ok) expect(r.reason).not.toMatch(/SyntaxKind|undefined|\[object/);
        return;
      }
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      if (!r.ok) return;
      for (const cav of r.caveats) expect(cav).not.toMatch(/did not run/);
      const u = await sb.load(`gu:${c.name}`, r.unit, 'f', { values: 'js' });
      expect(u, JSON.stringify(u)).toMatchObject({ ok: true });
      const w = await sb.load(`gw:${c.name}`, c.src, 'f', { values: 'js' });
      try {
        if (!w.ok) {
          // the whole file never ran in the sandbox (masked globals): nothing to compare. But a whole file refused for
          // changing a built-in is exactly what extraction must refuse too, never a silent pass.
          expect(w.error).not.toMatch(/impure at load|Function constructor|used globalThis/);
          return;
        }
        for (const x of [1, 2, 5]) expect((await sb.call(`gu:${c.name}`, [x])).outcome).toEqual((await sb.call(`gw:${c.name}`, [x])).outcome);
      } finally {
        await sb.unload(`gu:${c.name}`);
        await sb.unload(`gw:${c.name}`).catch(() => undefined);
      }
    });
  }
});

/**
 * Plain-evaluation oracle: the real file and the extracted unit are both transpiled to CommonJS and run in a fresh `vm`
 * context (its own intrinsics, so a patched `Array.prototype` or `globalThis.k` never leaks), where `Function`, `eval`
 * and `globalThis` are the real ones (the sandbox traps them, so the sandbox oracle cannot compare these shapes).
 */
function plainOutcome(src: string, fn: string, args: Val[]): string {
  try {
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const ctx = vm.createContext({ exports: {}, module: { exports: {} } });
    vm.runInContext(js, ctx);
    return JSON.stringify({ ok: (ctx.exports as Record<string, (...a: Val[]) => unknown>)[fn]!(...args) });
  } catch (e) {
    return JSON.stringify({ throw: String(e) });
  }
}
const PLAIN_INPUTS: Val[][] = [[1], [2], [5]];
const plainAll = (src: string): string[] => PLAIN_INPUTS.map((a) => plainOutcome(src, 'f', a));

const PC = `const cfg = { k: 1 };\n`;
const PF = `export function f(n: number): number { return n + cfg.k; }\n`;
const INC = `export function f(n: number): number { return [1, 2].includes(n) ? 1 : 0; }\n`;
const GF = `export function f(n: number): number { return n + (((globalThis as any).k as number | undefined) ?? 1); }\n`;
const PATCH = `function () { return true; }`;
const OBJF = `export function f(n: number): number { return n + (({} as any).k ?? 1); }\n`;
const VARF = `export function f(n: number): number { return n + vv; }\n`;

/** Relaxed shapes (rule 5): extracted, and the unit behaves exactly like the whole file evaluated by itself. */
const PLAIN_ALLOWED: Array<{ name: string; src: string; caveat?: boolean }> = [
  { name: 'alias of Function, unused', src: `${PC}const RealFunction = Function;\n${PF}` },
  { name: 'alias of eval, unused', src: `${PC}const e = eval;\n${PF}` },
  { name: 'alias of eval, used only by a dropped function nothing calls at load', src: `${PC}const e = eval;\nfunction run(s: string): unknown { return e(s); }\n${PF}` },
  { name: 'alias of getPrototypeOf whose results are only compared', src: `${PC}const getProto = Object.getPrototypeOf;\nconst a = getProto({}) === Object.prototype;\nif (getProto([]) !== Array.prototype) throw new Error('x');\n${PF}` },
  { name: 'constructor compared, its name read, typeof', src: `${PC}const same = ([] as any).constructor === Array;\nif (({} as any).constructor.name !== 'Object') throw new Error('x');\nconst t = typeof ([] as any).constructor;\n${PF}` },
  { name: 'a load-time IIFE that writes its own arguments object', src: `${PC}(function () { arguments[0] = 1; })(0);\n${PF}` },
  { name: 'globalThis read, never changed', src: `${PC}const has = typeof globalThis !== 'undefined';\nconst u = (globalThis as any).someUnsetName;\n${PF}` },
  { name: '`export default { helper }` stores a function that would change included state if called', src: `${PC}function helper(): void { cfg.k = 100; }\n${PF}export default { helper };\n`, caveat: true },
  { name: '`export default helper`', src: `${PC}function helper(): void { cfg.k = 100; }\n${PF}export default helper;\n`, caveat: true },
  { name: 'arguments.__proto__ only compared (nothing changed)', src: `${PC}(function () { const same = (arguments as any).__proto__ === Object.prototype; if (!same) throw new Error('x'); })();\n${PF}` },
  { name: 'a method looked up on a prototype and applied to something else', src: `${PC}const has = Object.prototype.hasOwnProperty.call({}, 'k');\nconst part = Array.prototype.slice.call([1, 2, 3], 1);\n${PF}` },
  { name: 'an included function that only computes, called at load', src: `function dbl(x: number): number { return x * 2; }\nconst D = dbl(4);\nexport function f(n: number): number { return dbl(n); }\n` },
  { name: 'a top-level `for (var i ...)` and a function with a var of its own of the same name', src: `for (var i = 0; i < 3; i++) {}\nexport function f(n: number): number { var i = 2; return n + i; }\n` },
  { name: '`export default` of nested literals of functions and classes', src: `${PC}function helper(): void { cfg.k = 100; }\nclass Box { put(): void { cfg.k = 5; } }\n${PF}export default { a: { b: [helper, Box] }, helper };\n`, caveat: true },
];

/**
 * Nearest unsafe neighbours of the relaxations, and the holes the guard used to have: each must be REFUSED, and each is
 * unsafe for real: the would-be unit (`unit`, what dropping the statements would have produced) behaves differently
 * from the whole file evaluated by itself on at least one input.
 */
const PLAIN_HOLES: Array<{ name: string; src: string; unit: string; refuse: RegExp }> = [
  { name: 'globalThis.k written at load', src: `(globalThis as any).k = 100;\n${GF}`, unit: GF, refuse: /changes the built-in globalThis\.k/ },
  { name: 'Object.defineProperty(globalThis, ...)', src: `Object.defineProperty(globalThis, 'k', { value: 100 });\n${GF}`, unit: GF, refuse: /passes on the built-in globalThis/ },
  { name: 'code from a string through Array.constructor', src: `(Array as any).constructor('Array.prototype.includes = ${PATCH}')();\n${INC}`, unit: INC, refuse: /reaches \.constructor/ },
  { name: 'code from a string through [].constructor.constructor', src: `([] as any).constructor.constructor('Array.prototype.includes = ${PATCH}')();\n${INC}`, unit: INC, refuse: /reaches \.constructor/ },
  { name: 'code from a string through globalThis.eval', src: `(globalThis as any).eval('Array.prototype.includes = ${PATCH}');\n${INC}`, unit: INC, refuse: /reaches \.eval/ },
  { name: "code from a string through globalThis['Function']", src: `(globalThis as any)['Function']('Array.prototype.includes = ${PATCH}')();\n${INC}`, unit: INC, refuse: /reaches \.Function/ },
  { name: 'direct eval in the function reads a name the unit would leave out', src: `${PC}export function f(n: number): number { return eval('n + cfg.k') as number; }\n`, unit: `export function f(n: number): number { return eval('n + cfg.k') as number; }\n`, refuse: /it calls eval, which can read any name in the file/ },
  { name: 'alias of eval run at load', src: `const e = eval;\ne('Array.prototype.includes = ${PATCH}');\n${INC}`, unit: INC, refuse: /e, which is another name for eval/ },
  { name: 'alias of Function used at load', src: `const RF = Function;\nRF('Array.prototype.includes = ${PATCH}')();\n${INC}`, unit: INC, refuse: /RF, which is another name for Function/ },
  { name: 'alias of getPrototypeOf, result bound and patched', src: `const gp = Object.getPrototypeOf;\nconst AP: any = gp([]);\nAP.includes = ${PATCH};\n${INC}`, unit: INC, refuse: /result of gp, which is another name for Object\.getPrototypeOf/ },
  { name: 'alias of getPrototypeOf, result patched in place', src: `const gp = Object.getPrototypeOf;\n(gp([]) as any).includes = ${PATCH};\n${INC}`, unit: INC, refuse: /result of gp/ },
  { name: 'getPrototypeOf called, result bound and patched', src: `const AP: any = Object.getPrototypeOf([]);\nAP.includes = ${PATCH};\n${INC}`, unit: INC, refuse: /keeps the result of getPrototypeOf/ },
  { name: 'Reflect.getPrototypeOf, result bound and patched', src: `const AP: any = Reflect.getPrototypeOf([]);\nAP.includes = ${PATCH};\n${INC}`, unit: INC, refuse: /keeps the result of getPrototypeOf/ },
  { name: 'getPrototypeOf handed on as a value', src: `const fns: any[] = [Object.getPrototypeOf];\nfns[0]([]).includes = ${PATCH};\n${INC}`, unit: INC, refuse: /passes on getPrototypeOf/ },
  { name: 'Array.prototype reached with a key built at run time', src: `const k = 'proto' + 'type';\nconst P: any = (Array as any)[k];\nP.includes = ${PATCH};\n${INC}`, unit: INC, refuse: /passes on the built-in Array\.\[\]/ },
  { name: '`export default` of an object bound to a name that load-time code uses', src: `${PC}function bump(): void { cfg.k = 100; }\nconst api = { bump };\napi.bump();\nexport default api;\n${PF}`, unit: PC + PF, refuse: /changes cfg, which the function reads/ },
  // --- review round 2: shapes that reached a shared built-in or changed a variable the function reads without being named ---
  { name: 'Object.prototype reached through arguments.__proto__ (the call\'s own arguments object)', src: `(function () { (arguments as any).__proto__.k = 100; })();\n${OBJF}`, unit: OBJF, refuse: /through arguments\.__proto__\.k/ },
  { name: "arguments['__proto__'] with a string key", src: `(function () { (arguments as any)['__proto__'].k = 100; })();\n${OBJF}`, unit: OBJF, refuse: /through arguments\.__proto__\.k/ },
  { name: 'arguments.__proto__ bound, then changed', src: `(function () { const p = (arguments as any).__proto__; p.k = 100; })();\n${OBJF}`, unit: OBJF, refuse: /through arguments\.__proto__ and changes or passes/ },
  { name: 'arguments.__proto__ handed to Object.defineProperty', src: `(function () { Object.defineProperty((arguments as any).__proto__, 'k', { value: 100 }); })();\n${OBJF}`, unit: OBJF, refuse: /through arguments\.__proto__ and changes or passes/ },
  { name: 'arguments.__proto__ handed to Object.assign, inside a dropped function that is called', src: `function init(): void { Object.assign((arguments as any).__proto__, { k: 100 }); }\ninit();\n${OBJF}`, unit: OBJF, refuse: /through arguments\.__proto__ and changes or passes/ },
  { name: 'arguments.__proto__ with a method called on it', src: `(function () { (arguments as any).__proto__.__defineGetter__('k', () => 100); })();\n${OBJF}`, unit: OBJF, refuse: /calls a method on a shared prototype \(arguments\.__proto__\.__defineGetter__\)/ },
  { name: 'a var re-declared in an if block of load-time code', src: `var vv = 1;\nif (true) { var vv = 100; }\n${VARF}`, unit: `var vv = 1;\n${VARF}`, refuse: /vv, which another statement of the file declares again with `var`/ },
  { name: 'a var re-declared by `for (var vv of ...)`', src: `var vv = 1;\nfor (var vv of [100]) {}\n${VARF}`, unit: `var vv = 1;\n${VARF}`, refuse: /vv, which another statement of the file declares again with `var`/ },
  { name: 'a var re-declared in a try block', src: `var vv = 1;\ntry { var vv = 100; } catch {}\n${VARF}`, unit: `var vv = 1;\n${VARF}`, refuse: /vv, which another statement of the file declares again with `var`/ },
  { name: 'a var re-declared by a destructuring `var` in a block', src: `var vv = 1;\n{ var { vv } = { vv: 100 }; }\n${VARF}`, unit: `var vv = 1;\n${VARF}`, refuse: /vv, which another statement of the file declares again with `var`/ },
  { name: 'a var that exists only because a block hoists it', src: `if (true) { var vv = 100; }\n${VARF}`, unit: VARF, refuse: /vv, which another statement of the file declares again with `var`/ },
  { name: 'a function re-declared by a var in a block (different symbols in the checker)', src: `function h(): number { return 1; }\nif (true) { var h: any = () => 100; }\nexport function f(n: number): number { return n + h(); }\n`, unit: `function h(): number { return 1; }\nexport function f(n: number): number { return n + h(); }\n`, refuse: /h, which another statement of the file declares again with `var`/ },
  { name: 'a polyfill installer called at load, not by the function', src: `function patch(): void { (Array.prototype as any).includes = ${PATCH}; }\npatch();\nexport function f(n: number, flag: boolean = false): number { if (flag) patch(); return [1, 2].includes(n) ? 1 : 0; }\n`, unit: `function patch(): void { (Array.prototype as any).includes = ${PATCH}; }\nexport function f(n: number, flag: boolean = false): number { if (flag) patch(); return [1, 2].includes(n) ? 1 : 0; }\n`, refuse: /changes the built-in Array\.prototype\.includes/ },
  { name: 'an included function that returns a built-in, called at load and changed through its result', src: `function M(): any { return Math; }\nM().max = () => 0;\nexport function f(n: number): number { return M().max(n, 1); }\n`, unit: `function M(): any { return Math; }\nexport function f(n: number): number { return M().max(n, 1); }\n`, refuse: /passes on the built-in Math/ },
  { name: 'an included function that returns Array.prototype', src: `function AP(): any { return Array.prototype; }\n(AP() as any).includes = ${PATCH};\nexport function f(n: number): number { return AP().includes(n) ? 1 : 0; }\n`, unit: `function AP(): any { return Array.prototype; }\nexport function f(n: number): number { return AP().includes(n) ? 1 : 0; }\n`, refuse: /passes on the built-in Array\.prototype/ },
  { name: 'an included function that defines a property on a built-in, called at load', src: `function patch(): void { Object.defineProperty(Math, 'max', { value: () => 0 }); }\npatch();\nexport function f(n: number): number { if (n > 100) patch(); return Math.max(n, 1); }\n`, unit: `function patch(): void { Object.defineProperty(Math, 'max', { value: () => 0 }); }\nexport function f(n: number): number { if (n > 100) patch(); return Math.max(n, 1); }\n`, refuse: /passes on the built-in Math/ },
  { name: 'Object.assign onto the prototype of a function the function constructs', src: `function Box(this: any) {}\nObject.assign((Box as any).prototype, { k: 100 });\nexport function f(n: number): number { return n + ((new (Box as any)()).k ?? 1); }\n`, unit: `function Box(this: any) {}\nexport function f(n: number): number { return n + ((new (Box as any)()).k ?? 1); }\n`, refuse: /passes on Box, which the function uses/ },
  { name: 'Object.defineProperty on the prototype of a function the function constructs', src: `function Box(this: any) {}\nObject.defineProperty((Box as any).prototype, 'k', { value: 100 });\nexport function f(n: number): number { return n + ((new (Box as any)()).k ?? 1); }\n`, unit: `function Box(this: any) {}\nexport function f(n: number): number { return n + ((new (Box as any)()).k ?? 1); }\n`, refuse: /passes on Box, which the function uses/ },
  { name: "Object.defineProperty on a function's own `call`, which the function uses as helper.call(...)", src: `function helper(x: number): number { return x; }\nObject.defineProperty(helper, 'call', { value: () => 100 });\nexport function f(n: number): number { return helper.call(null, n); }\n`, unit: `function helper(x: number): number { return x; }\nexport function f(n: number): number { return helper.call(null, n); }\n`, refuse: /passes on helper, which the function uses/ },
  { name: 'a shorthand `{ Math }` handed on, then changed through the object', src: `const w: any = { Math };\nw.Math.max = () => 0;\nexport function f(n: number): number { return Math.max(n, 1); }\n`, unit: `export function f(n: number): number { return Math.max(n, 1); }\n`, refuse: /passes on the built-in Math/ },
  { name: 'a shorthand `{ eval }` then called through a destructured name', src: `const w: any = { eval };\nconst { eval: ev } = w;\nev('Array.prototype.includes = ${PATCH}');\n${INC}`, unit: INC, refuse: /runs code from a string \(eval\)/ },
  { name: 'a shorthand `{ Function }` then constructed', src: `const w: any = { Function };\nnew w.Function('Array.prototype.includes = ${PATCH}')();\n${INC}`, unit: INC, refuse: /runs code from a string \(Function\)/ },
  { name: 'Array.prototype.push called on the prototype itself', src: `(Array.prototype as any).push(7);\nexport function f(n: number): number { return n + (([] as any)[0] ?? 0); }\n`, unit: `export function f(n: number): number { return n + (([] as any)[0] ?? 0); }\n`, refuse: /calls a method on the built-in Array\.prototype\.push/ },
  { name: 'Object.prototype.__defineGetter__ called', src: `(Object.prototype as any).__defineGetter__('k', () => 100);\n${OBJF}`, unit: OBJF, refuse: /calls a method on the built-in Object\.prototype\.__defineGetter__/ },
  { name: 'a method called on [].__proto__', src: `([] as any).__proto__.push(7);\nexport function f(n: number): number { return n + (([] as any)[0] ?? 0); }\n`, unit: `export function f(n: number): number { return n + (([] as any)[0] ?? 0); }\n`, refuse: /reaches a built-in prototype and changes, calls a method on, or passes it on/ },
  { name: 'a method called on o.__proto__ of a binding of the file', src: `const o: any = {};\no.__proto__.__defineGetter__('k', () => 100);\n${OBJF}`, unit: OBJF, refuse: /calls a method on a shared prototype \(o\.__proto__\.__defineGetter__\)/ },
  { name: 'Function constructor picked out of an array by destructuring', src: `const { constructor: C } = [] as any;\nconst { constructor: Fn } = C;\nFn('Array.prototype.includes = ${PATCH}')();\n${INC}`, unit: INC, refuse: /picks \.constructor out of an object by destructuring/ },
  { name: 'a nested destructuring pattern that reaches Array.prototype', src: `const { constructor: { prototype: AP } } = [] as any;\nAP.includes = ${PATCH};\n${INC}`, unit: INC, refuse: /picks \.constructor out of an object by destructuring/ },
  { name: '__proto__ picked out by destructuring', src: `const { __proto__: AP } = [] as any;\nAP.includes = ${PATCH};\n${INC}`, unit: INC, refuse: /picks \.__proto__ out of an object by destructuring/ },
  { name: 'constructor picked out by a destructuring ASSIGNMENT', src: `let C: any;\n({ constructor: C } = [] as any);\nC('Array.prototype.includes = ${PATCH}')();\n${INC}`, unit: INC, refuse: /picks \.constructor out of an object by destructuring/ },
  { name: '`export default [helper].map(...)` calls it at load', src: `${PC}function bump(): number { cfg.k = 100; return 1; }\nexport default [bump].map((g) => g());\n${PF}`, unit: PC + PF, refuse: /changes cfg, which the function reads/ },
  { name: '`export default { v: helper() }` calls it at load', src: `${PC}function bump(): number { cfg.k = 100; return 1; }\nexport default { v: bump() };\n${PF}`, unit: PC + PF, refuse: /changes cfg, which the function reads/ },
];

describe('extractUnit: relaxations and closed holes (plain evaluation of the real file)', () => {
  for (const c of PLAIN_ALLOWED) {
    it(`extracted, and the unit equals the whole file: ${c.name}`, () => {
      const r = extractUnit(c.src, 'f');
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      if (!r.ok) return;
      if (c.caveat) expect(r.caveats.join(' ')).toMatch(/can change cfg when it is called/);
      const whole = plainAll(c.src);
      expect(whole.every((o) => !o.includes('throw'))).toBe(true);
      expect(plainAll(r.unit)).toEqual(whole);
    });
  }
  for (const c of PLAIN_HOLES) {
    it(`refused, and unsafe for real: ${c.name}`, () => {
      const r = extractUnit(c.src, 'f');
      expect(r, JSON.stringify(r)).toMatchObject({ ok: false });
      if (!r.ok) {
        expect(r.reason).toMatch(c.refuse);
        expect(r.reason).not.toMatch(/SyntaxKind|undefined|\[object/);
      }
      // the refusal is needed: what extraction would have produced behaves differently from the file
      expect(plainAll(c.unit)).not.toEqual(plainAll(c.src));
    });
  }
});

/**
 * "Included code's own changes to built-ins when called" are not analysed STATICALLY (SECURITY.md, honest limits), and need
 * not be: the unit and the whole file run that code identically, and the sandbox's purity mask catches it when it runs.
 * Every call that changes a built-in (or the global object) faults as impure, the built-in is restored, and the Tested
 * differential excludes and counts such inputs (`originalFaults`). Pinned here for the shapes a reviewer would try.
 */
describe('extractUnit: included code that changes a built-in when it is called (caught when it runs)', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });
  const PROBE = `export function probe(n: number): boolean { return [1, 2].includes(n); }\n`;
  const SHAPES: Array<[string, string, RegExp]> = [
    ['in the function itself', `export function f(n: number): number { (Array.prototype as any).includes = function () { return true; }; return n; }\n`, /impure: modified Array\.prototype\.includes/],
    ['in an included helper', `function patch(): void { (Array.prototype as any).includes = function () { return true; }; }\nexport function f(n: number): number { patch(); return n; }\n`, /impure: modified Array\.prototype\.includes/],
    ['adding a property to a prototype', `export function f(n: number): number { (Object.prototype as any).extra = n; return n; }\n`, /impure: added property extra to Object\.prototype/],
    ['on the global object', `export function f(n: number): number { (globalThis as any).zz = n; return n; }\n`, /impure: globalThis/],
  ];
  for (const [name, src, impure] of SHAPES) {
    it(`${name}: extracted, then every call faults as impure and the built-in is restored`, async () => {
      const r = extractUnit(src, 'f');
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(await sb.load('bi:f', r.unit, 'f', { values: 'js' })).toMatchObject({ ok: true });
      for (const x of [1, 5]) {
        const o = (await sb.call('bi:f', [x])).outcome;
        expect(o.tag).toBe('fault');
        expect(JSON.stringify(o)).toMatch(impure);
      }
      expect(await sb.load('bi:probe', PROBE, 'probe', { values: 'js' })).toMatchObject({ ok: true });
      expect((await sb.call('bi:probe', [5])).outcome).toEqual({ tag: 'ok', value: false });
      await sb.unload('bi:f');
      await sb.unload('bi:probe');
    });
  }
});

describe('extractUnit: refusals that cover the whole file too', () => {
  it('an overloaded target is marked sameForWholeFile (no whole-file fallback)', () => {
    const r = extractUnit(`export function f(n: number): number;\nexport function f(n: string): string;\nexport function f(n: any): any { return n + 0; }\n`, 'f');
    expect(r).toMatchObject({ ok: false, sameForWholeFile: true, line: 1 });
  });
  it('an ordinary refusal is not', () => {
    const r = extractUnit(`import { h } from './h';\nexport function f(x: number): number { return h(x); }\n`, 'f');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sameForWholeFile).toBeUndefined();
  });
});

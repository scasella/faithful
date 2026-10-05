/**
 * Faithful.Core helpers against Node on a grid of edge cases (negative / out-of-range indices, empty separators,
 * missing elements), plus the spot checks where TypeScript and Lean usually differ. Expected values are computed here
 * with JavaScript, never typed by hand.
 */
import { describe, expect, it } from 'vitest';
import { resolveLeanDir } from '@faithful/core';
import { leanStrList } from './index.js';
import { parseLeanOutcome, translate, leanEvalExpr } from './index.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;
const prover = (): Promise<typeof import('../../prover/src/lean.js')> => import('../../prover/src/lean.js');

const I = (n: number): string => `(${n} : Int)`;
const S = (s: string): string => `(${leanStrList(s)} : List Char)`;
const L = (xs: number[]): string => `([${xs.map(I).join(', ')}] : List Int)`;

describe.skipIf(!hasLean)('Faithful.Core helpers match JavaScript', () => {
  it('grid of edge cases', async () => {
    const cases: Array<{ lean: string; js: unknown }> = [];
    const str = (lean: string, js: string): void => void cases.push({ lean: `Faithful.jStr (${lean})`, js });
    const int = (lean: string, js: number): void => void cases.push({ lean: `Faithful.jInt (${lean})`, js });
    const strs = (lean: string, js: string[]): void => void cases.push({ lean: `Faithful.jList Faithful.jStr (${lean})`, js });
    const ints = (lean: string, js: number[]): void => void cases.push({ lean: `Faithful.jList Faithful.jInt (${lean})`, js });
    const bool = (lean: string, js: boolean): void => void cases.push({ lean: `Faithful.jBool (${lean})`, js });
    const idx = [-7, -5, -2, -1, 0, 1, 2, 4, 5, 6];
    const text = 'abcde';
    const arr = [10, 20, 30, 40, 50];
    for (const a of idx) {
      str(`Faithful.sliceFrom ${S(text)} ${I(a)}`, text.slice(a));
      ints(`Faithful.sliceFrom ${L(arr)} ${I(a)}`, arr.slice(a));
      str(`Faithful.charAt ${S(text)} ${I(a)}`, text.charAt(a));
      for (const b of idx) {
        str(`Faithful.slice ${S(text)} ${I(a)} ${I(b)}`, text.slice(a, b));
        ints(`Faithful.slice ${L(arr)} ${I(a)} ${I(b)}`, arr.slice(a, b));
      }
    }
    for (const sub of ['', 'b', 'cd', 'x', 'abcde', 'abcdef', 'e']) {
      for (const pos of [-2, 0, 2, 4, 5, 9]) int(`Faithful.strIndexOf ${S('abcdebcd')} ${S(sub)} ${I(pos)}`, 'abcdebcd'.indexOf(sub, pos));
    }
    for (const [s, sep] of [['a,b,,c', ','], ['', ','], ['', ''], ['abc', ''], ['abab', 'ab'], ['aaa', 'aa'], ['a,b,', ','], ['xyz', 'xyz'], ['xyzw', 'w']])
      strs(`Faithful.split ${S(s!)} ${S(sep!)}`, s!.split(sep!));
    for (const xs of [[], ['a'], ['a', '', 'b']]) str(`Faithful.join [${xs.map(S).join(', ')}] ${S('-')}`, xs.join('-'));
    for (const n of [0, -0, 7, -7, 9007199254740992, -9007199254740992]) str(`Faithful.intToStr ${I(n)}`, String(n));
    str(`Faithful.toLower ${S('AbZ@[`az{09')}`, 'AbZ@[`az{09'.toLowerCase());
    str(`Faithful.toUpper ${S('AbZ@[`az{09')}`, 'AbZ@[`az{09'.toUpperCase());
    for (const x of [10, 30, 99]) {
      int(`Faithful.indexOf ${L(arr)} ${I(x)}`, arr.indexOf(x));
      bool(`Faithful.includes ${L(arr)} ${I(x)}`, arr.includes(x));
    }
    for (const a of [-7, 7, -8, 8, 0, -1, 9007199254740992])
      for (const b of [3, -3, 2, -2, 1, 7]) {
        int(`Int.tmod ${I(a)} ${I(b)}`, a % b === 0 ? 0 : a % b);
        int(`Int.fdiv ${I(a)} ${I(b)}`, Math.floor(a / b));
        int(`Faithful.cdiv ${I(a)} ${I(b)}`, Math.ceil(a / b) === 0 ? 0 : Math.ceil(a / b));
      }
    for (const [a, b] of [['a', 'b'], ['b', 'a'], ['ab', 'a'], ['a', 'ab'], ['', ''], ['', 'a'], ['Z', 'a'], ['é', 'z'], ['abc', 'abd']]) {
      bool(`Faithful.strLt ${S(a!)} ${S(b!)}`, a! < b!);
      bool(`Faithful.strLe ${S(a!)} ${S(b!)}`, a! <= b!);
    }
    for (const i of [-1, 0, 2, 3]) int(`Faithful.charCodeAt ${S('aé~')} ${I(i)}`, i >= 0 && i < 3 ? 'aé~'.charCodeAt(i) : 0);
    const { evalBatch } = await prover();
    const r = await evalBatch('import Faithful.Core', cases.map((c) => `IO.println (${c.lean}).compress`), { budgetMs: 120_000 });
    expect(r.check.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
    cases.forEach((c, k) => {
      expect(JSON.parse(r.outputs[k] ?? "null"), c.lean).toEqual(JSON.parse(JSON.stringify(c.js)));
    });
  });

  it('spot checks where TypeScript and Lean usually differ', async () => {
    const src = `type R = { k: number; id: number };
      export function spots(rs: R[]): (number | string)[] {
        return [-7 % 3, Math.floor(-7 / 2), "abc".slice(-2), [1, 2, 3].slice(1, -1).join(","), rs.slice().sort((a, b) => a.k - b.k).map((r) => r.id).join(""),
          "abc".charAt(5), [1, 2, 3].indexOf(9), "abc".indexOf("z")];
      }`;
    // the array of mixed primitives is outside the subset; use one function per spot instead
    expect(translate(src, 'spots').ok).toBe(false);
    const spots: Array<{ src: string; fn: string; args: unknown[]; js: () => unknown }> = [
      { fn: 'a', src: 'export function a(x: number, y: number): number { return x % y; }', args: [-7, 3], js: () => -7 % 3 },
      { fn: 'b', src: 'export function b(x: number, y: number): number { return Math.floor(x / y); }', args: [-7, 2], js: () => Math.floor(-7 / 2) },
      { fn: 'c', src: 'export function c(s: string): string { return s.slice(-2); }', args: ['abc'], js: () => 'abc'.slice(-2) },
      { fn: 'd', src: 'export function d(xs: number[]): number[] { return xs.slice(1, -1); }', args: [[1, 2, 3]], js: () => [1, 2, 3].slice(1, -1) },
      {
        fn: 'e',
        src: 'type R = { k: number; id: number };\nexport function e(rs: R[]): number[] { return rs.slice().sort((a, b) => a.k - b.k).map((r) => r.id); }',
        args: [[{ k: 1, id: 0 }, { k: 0, id: 1 }, { k: 1, id: 2 }, { k: 0, id: 3 }, { k: 1, id: 4 }]],
        js: () => [{ k: 1, id: 0 }, { k: 0, id: 1 }, { k: 1, id: 2 }, { k: 0, id: 3 }, { k: 1, id: 4 }].sort((a, b) => a.k - b.k).map((r) => r.id),
      },
      { fn: 'f', src: 'export function f(s: string): string { return s.charAt(5); }', args: ['abc'], js: () => 'abc'.charAt(5) },
      { fn: 'g', src: 'export function g(xs: number[]): number { return xs.indexOf(9); }', args: [[1, 2, 3]], js: () => [1, 2, 3].indexOf(9) },
      { fn: 'h', src: 'export function h(s: string): number { return s.indexOf("z"); }', args: ['abc'], js: () => 'abc'.indexOf('z') },
    ];
    const { evalBatch } = await prover();
    for (const s of spots) {
      const t = translate(s.src, s.fn);
      if (!t.ok) throw new Error(JSON.stringify(t.refusal));
      const r = await evalBatch(t.lean.source, [leanEvalExpr(t, s.args as never)], { budgetMs: 60_000 });
      expect(parseLeanOutcome(r.outputs[0]), s.fn).toEqual({ tag: 'ok', value: s.js() });
    }
    // and the values themselves are the JavaScript ones Lean's own operators would get wrong
    expect(-7 % 3).toBe(-1);
    expect(Math.floor(-7 / 2)).toBe(-4);
  });
});

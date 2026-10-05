import { describe, expect, it } from 'vitest';
import { cdiv, fdiv, iabs, inRange, tmod } from './intsem.js';
import { readAnswers, transcript } from './sexpr.js';
import { Smt, int } from './terms.js';
import { openSystemZ3, openWasmZ3 } from './z3.js';

const P53 = 2n ** 53n;

/** JavaScript's own operators on doubles (exact for these operands; DESIGN.md "Integer semantics"). */
const js = {
  tmod: (a: bigint, b: bigint): bigint => BigInt(Number(a) % Number(b)),
  fdiv: (a: bigint, b: bigint): bigint => BigInt(Math.floor(Number(a) / Number(b))),
  cdiv: (a: bigint, b: bigint): bigint => BigInt(Math.ceil(Number(a) / Number(b))),
};

function pairs(): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  const as: bigint[] = [];
  for (let a = -9n; a <= 9n; a++) as.push(a);
  as.push(P53, -P53, P53 - 1n, -(P53 - 1n), 1000003n, -1000003n, 4503599627370497n, -4503599627370497n);
  const bs: bigint[] = [];
  for (let b = -5n; b <= 5n; b++) if (b !== 0n) bs.push(b);
  bs.push(7n, -7n, 10n, -10n, 1024n, -1024n, P53, -P53, P53 - 1n, 3n ** 33n, -(3n ** 33n));
  for (const a of as) for (const b of bs) out.push([a, b]);
  return out;
}

describe.each([
  ['wasm', openWasmZ3],
  ['system', openSystemZ3],
] as const)('integer semantics against JavaScript through Z3 (%s)', (_kind, open) => {
  it('tmod / fdiv / cdiv / abs agree with JS % , Math.floor(a / b), Math.ceil(a / b) on symbolic and literal operands', async () => {
    const z = await open();
    if (!z) return;
    const ps = pairs();
    const smt = new Smt();
    const terms: string[] = [];
    const want: bigint[] = [];
    ps.forEach(([a, b], i) => {
      // symbolic operands (the ite on signs is decided by Z3) ...
      const x = smt.fresh('Int', `a${i}`);
      const y = smt.fresh('Int', `b${i}`);
      smt.assert(`(= ${x} ${int(a)})`);
      smt.assert(`(= ${y} ${int(b)})`);
      terms.push(tmod(x, y), fdiv(x, y), cdiv(x, y), iabs(x));
      want.push(js.tmod(a, b), js.fdiv(a, b), js.cdiv(a, b), a < 0n ? -a : a);
      // ... and literal operands (the folded forms)
      terms.push(tmod(int(a), int(b)), fdiv(int(a), int(b)), cdiv(int(a), int(b)));
      want.push(js.tmod(a, b), js.fdiv(a, b), js.cdiv(a, b));
    });
    const script = `${smt.text()}\n(check-sat)\n(get-value (${terms.join(' ')}))\n`;
    const r = await z.solve(script, { timeoutMs: 60_000 });
    expect(r.status).toBe('sat');
    const { answers, errors } = readAnswers(transcript(r));
    expect(errors).toEqual([]);
    const got = answers[0]!.values!;
    expect(got.length).toBe(want.length);
    const bad: string[] = [];
    got.forEach((g, i) => {
      if (g !== want[i]) bad.push(`#${i} (${ps[Math.floor(i / 7)]!.join(', ')}): got ${g}, want ${want[i]}`);
    });
    expect(bad).toEqual([]);
    expect(ps.length * 7).toBeGreaterThan(900);
  });

  it('the range check is inclusive at ±2^53 and exact one past it', async () => {
    const z = await open();
    if (!z) return;
    const vals = [P53, -P53, P53 + 1n, -P53 - 1n, 0n, P53 - 1n];
    const script = `(check-sat)\n(get-value (${vals.map((v) => inRange(int(v))).join(' ')}))`;
    const r = await z.solve(script, { timeoutMs: 30_000 });
    const got = readAnswers(transcript(r)).answers[0]!.values!;
    expect(got).toEqual([true, true, false, false, true, true]);
  });
});

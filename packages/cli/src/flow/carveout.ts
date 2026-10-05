/**
 * Carve-outs. When the user rules "my function is wrong" and chooses to exclude that class of inputs from the theorem, the
 * class is picked from a menu derived deterministically from the disagreeing input; the Lean and TypeScript predicates are
 * generated here (no model, no free text). The carve-out is a PRECONDITION on kept inputs: it is true for inputs we keep.
 */
import type { Precondition, Translation, Ty, Val } from '@faithful/translate';
import { hashOf } from '@faithful/core';

export type CarveClass =
  | { param: number; kind: 'negative' | 'zero' | 'positive' | 'equals' }
  | { param: number; kind: 'empty' | 'length-equals' }
  | { param: number; kind: 'exact-input' };

export interface CarveOption {
  cls: CarveClass;
  /** What is excluded, in plain words. */
  excluded: string;
}

function leanName(t: Translation, i: number): string {
  return t.lean.paramNames?.[i] ?? t.params[i]!.name;
}

function show(v: Val): string {
  return JSON.stringify(v);
}

/** The classes the user can carve out, given the disagreeing input. */
export function carveOptions(t: Translation, input: Val[]): CarveOption[] {
  const out: CarveOption[] = [];
  t.params.forEach((p, i) => {
    const v = input[i]!;
    const n = p.name;
    if (p.ty.k === 'int' && typeof v === 'number') {
      if (v < 0) out.push({ cls: { param: i, kind: 'negative' }, excluded: `inputs where ${n} is negative` });
      if (v === 0) out.push({ cls: { param: i, kind: 'zero' }, excluded: `inputs where ${n} is 0` });
      if (v > 0) out.push({ cls: { param: i, kind: 'positive' }, excluded: `inputs where ${n} is positive` });
      out.push({ cls: { param: i, kind: 'equals' }, excluded: `inputs where ${n} is exactly ${v}` });
    } else if ((p.ty.k === 'array' || p.ty.k === 'string') && (Array.isArray(v) || typeof v === 'string')) {
      const len = v.length;
      if (len === 0) out.push({ cls: { param: i, kind: 'empty' }, excluded: `inputs where ${n} is empty` });
      else out.push({ cls: { param: i, kind: 'length-equals' }, excluded: `inputs where ${n} has length ${len}` });
    }
  });
  out.push({ cls: { param: -1, kind: 'exact-input' }, excluded: `only the input ${show(input as unknown as Val)}` });
  return out;
}

/** Lean `Bool` term over the Lean parameter names, and a JS boolean expression: both true for inputs that are KEPT. */
export function makeCarveOut(t: Translation, input: Val[], cls: CarveClass): Precondition {
  const opt = carveOptions(t, input).find((o) => o.cls.kind === cls.kind && o.cls.param === cls.param);
  if (!opt) throw new Error('carve-out class is not offered for this input');
  const names = t.params.map((p) => p.name);
  let lean: string;
  let ts: string;
  if (cls.kind === 'exact-input') {
    const eqs = t.params.map((p, i) => ({ lean: `(${leanName(t, i)} == ${leanLit(p.ty, input[i]!)})`, ts: `(JSON.stringify(${names[i]}) === ${JSON.stringify(JSON.stringify(input[i]))})` }));
    lean = `!(${eqs.map((e) => e.lean).join(' && ')})`;
    ts = `!(${eqs.map((e) => e.ts).join(' && ')})`;
  } else {
    const i = cls.param;
    const ln = leanName(t, i);
    const jn = names[i]!;
    const v = input[i]!;
    switch (cls.kind) {
      case 'negative':
        lean = `decide (${ln} ≥ 0)`;
        ts = `(${jn} >= 0)`;
        break;
      case 'zero':
        lean = `decide (${ln} ≠ 0)`;
        ts = `(${jn} !== 0)`;
        break;
      case 'positive':
        lean = `decide (${ln} ≤ 0)`;
        ts = `(${jn} <= 0)`;
        break;
      case 'equals':
        lean = `decide (${ln} ≠ ${leanLit({ k: 'int' }, v)})`;
        ts = `(${jn} !== ${v})`;
        break;
      case 'empty':
        lean = t.params[i]!.ty.k === 'string' ? `!(${ln}.isEmpty)` : `!(${ln}.isEmpty)`;
        ts = `(${jn}.length !== 0)`;
        break;
      case 'length-equals': {
        const len = (v as unknown[] | string).length;
        lean = `decide (${ln}.length ≠ ${len})`;
        ts = `(${jn}.length !== ${len})`;
        break;
      }
    }
  }
  return {
    id: `carve-${hashOf([cls, input]).slice(7, 15)}`,
    kind: 'carve-out',
    words: `Carved out (known problem in the original): ${opt.excluded} are excluded from everything proved below.`,
    lean,
    ts,
  };
}

function leanLit(ty: Ty, v: Val): string {
  if (ty.k === 'int') return typeof v === 'number' && v < 0 ? `(${v} : Int)` : `(${v} : Int)`;
  if (ty.k === 'string') return JSON.stringify(v);
  if (ty.k === 'bool') return String(v);
  return `[]`;
}

/**
 * From encoder statuses and model values to the `Outcome` domain shared with the sandbox and Lean.
 */
import type { Outcome, Ty } from '@faithful/translate';
import { ST_FUEL, THROW_BASE, VIOL_BASE, type Encoder, type R, type Shared } from './encode.js';
import { decode, leaves, type ModelValue } from './values.js';
import type { T } from './terms.js';

/** Decoded encoder result: an Outcome, or `fuel` (the unrolling bound was reached; nothing is claimed there). */
export type EncodedOutcome = Outcome | { tag: 'fuel' };

/** The terms to request with `get-value` to decode `r`. */
export function outcomeTerms(r: R): T[] {
  return [r.st, ...leaves(r.v)];
}

export function decodeOutcome(
  r: R,
  ret: Ty,
  enc: Encoder,
  shared: Shared,
  get: (t: T) => ModelValue,
): EncodedOutcome {
  const st = Number(get(r.st) as bigint);
  if (st === 0) return { tag: 'ok', value: decode(r.v, ret, get) };
  if (String(st) === ST_FUEL) return { tag: 'fuel' };
  if (st >= VIOL_BASE) return { tag: 'range-violation', detail: enc.checks[st - VIOL_BASE] ?? `unknown check ${st - VIOL_BASE}` };
  if (st >= THROW_BASE) return { tag: 'throw', message: shared.msgs[st - THROW_BASE] ?? `unknown message ${st - THROW_BASE}` };
  return { tag: 'fault', detail: `unexpected status ${st}` };
}

/** A lookup over `get-value` results aligned with the requested terms. */
export function lookup(terms: T[], values: ModelValue[]): (t: T) => ModelValue {
  const m = new Map<T, ModelValue>();
  terms.forEach((t, i) => m.set(t, values[i]!));
  return (t: T) => {
    if (t === 'true') return true;
    if (t === 'false') return false;
    const v = m.get(t);
    if (v === undefined) {
      if (/^\d+$/.test(t)) return BigInt(t);
      throw new Error(`internal: no model value for ${t}`);
    }
    return v;
  };
}

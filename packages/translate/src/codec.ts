/**
 * Values across the Lean boundary: JSON `Val` -> Lean literal, Lean `#eval` expressions that print an `Outcome` as
 * compact JSON, and parsing that output back.
 */
import type { Outcome, Translation, Ty, Val } from './contracts.js';
import { encoder, leanChar, leanInt, leanStrList, leanTy, recordsMap, type LeanCtx } from './emit.js';
import { recordKey, type RecordDecl } from './ir.js';

const MAX = 9007199254740992;

function ctxOf(records: Translation['lean']['records'] | RecordDecl[] | undefined): LeanCtx {
  return { records: recordsMap((records ?? []) as RecordDecl[]) };
}

/**
 * Lean literal for a value of subset type `ty`. Throws on a value that does not fit the type, a non-integer or
 * out-of-range number, or a string with surrogate code units (not representable as Lean `Char`s).
 * `records` comes from `translation.lean.records` and is needed only for record types.
 */
export function valueToLean(ty: Ty, val: Val, records?: Translation['lean']['records'] | RecordDecl[]): string {
  const c = ctxOf(records);
  const go = (t: Ty, v: Val, path: string): string => {
    const bad = (why: string): never => {
      throw new Error(`valueToLean: ${path} ${why}`);
    };
    switch (t.k) {
      case 'int':
        if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > MAX) bad(`is not an integer within ±2^53: ${JSON.stringify(v)}`);
        return leanInt(Object.is(v, -0) ? 0 : (v as number));
      case 'bool':
        if (typeof v !== 'boolean') bad('is not a boolean');
        return v ? 'true' : 'false';
      case 'string':
        if (typeof v !== 'string') bad('is not a string');
        for (let i = 0; i < (v as string).length; i++) leanChar((v as string).charCodeAt(i));
        return leanStrList(v as string);
      case 'array':
        if (!Array.isArray(v)) bad('is not an array');
        return `([${(v as Val[]).map((x, i) => go(t.elem, x, `${path}[${i}]`)).join(', ')}] : ${leanTy(t, c)})`;
      case 'tuple':
        if (!Array.isArray(v) || v.length !== t.elems.length) bad(`is not a ${t.elems.length}-tuple`);
        return `(${t.elems.map((e, i) => go(e, (v as Val[])[i]!, `${path}[${i}]`)).join(', ')})`;
      case 'record': {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) bad('is not an object');
        const r = c.records.get(recordKey(t));
        if (!r) throw new Error(`valueToLean: no Lean structure for record ${recordKey(t)} (pass translation.lean.records)`);
        const obj = v as { [k: string]: Val };
        const fs = r.fields.map((f) => {
          if (!(f.name in obj)) bad(`lacks field ${f.name}`);
          return `${f.lean} := ${go(f.ty, obj[f.name]!, `${path}.${f.name}`)}`;
        });
        return `({ ${fs.join(', ')} } : Model.${r.name})`;
      }
      case 'option':
        if (v === null) return `(none : ${leanTy(t, c)})`;
        return `(some ${go(t.inner, v, path)})`;
    }
  };
  return go(ty, val, 'value');
}

function argList(t: Translation, args: Val[]): string {
  if (args.length !== t.params.length) throw new Error(`expected ${t.params.length} arguments, got ${args.length}`);
  return t.params.map((p, i) => ' ' + valueToLean(p.ty, args[i]!, t.lean.records)).join('');
}

/**
 * Lean expression (for one `#eval` line) that prints the model's `Outcome` on `args` as compact JSON:
 * `{"tag":"ok","value":...}` or `{"tag":"throw","message":...}`. Use with `evalBatch(t.lean.source, exprs)`.
 */
export function leanEvalExpr(t: Translation, args: Val[]): string {
  const c = ctxOf(t.lean.records);
  const call = `(${t.lean.names.original}${argList(t, args)})`;
  const show = t.canThrow ? 'Faithful.showExcept' : 'Faithful.showPure';
  return `IO.println (${show} ${encoder(t.ret, c)} ${call})`;
}

/** Lean expression printing `true`/`false` for `Model.<fn>_rangeOk`, `_pre`, or `_asciiOk` on `args`. */
export function leanPredicateExpr(t: Translation, which: 'rangeOk' | 'pre' | 'asciiOk', args: Val[]): string {
  const name = which === 'asciiOk' ? t.lean.names.original + '_asciiOk' : t.lean.names[which];
  return `IO.println (toString (${name}${argList(t, args)}))`;
}

/** Lean expression printing the checked twin's value as an Outcome (range/ascii failures print as range-violation). */
export function leanChkEvalExpr(t: Translation, args: Val[]): string {
  const c = ctxOf(t.lean.records);
  const call = `(${t.lean.names.original}_chk${argList(t, args)})`;
  const enc = encoder(t.ret, c);
  return (
    `IO.println (match ${call} with ` +
    `| .ok v => Faithful.outOk (${enc} v) ` +
    `| .error (.thrown m) => Faithful.outThrow m ` +
    `| .error (.range d) => (Lean.Json.mkObj [("tag", "range-violation"), ("detail", Lean.Json.str d)]).compress ` +
    `| .error (.ascii d) => (Lean.Json.mkObj [("tag", "range-violation"), ("detail", Lean.Json.str d)]).compress)`
  );
}

/** Parse one line of Lean output into an Outcome. Anything that is not the expected JSON shape is a `fault`. */
export function parseLeanOutcome(text: string | null | undefined): Outcome {
  if (text === null || text === undefined) return { tag: 'fault', detail: 'no output from Lean' };
  let j: unknown;
  try {
    j = JSON.parse(text.trim());
  } catch {
    return { tag: 'fault', detail: `unparseable Lean output: ${text.trim().slice(0, 200)}` };
  }
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const o = j as Record<string, unknown>;
    if (o.tag === 'ok' && 'value' in o) return { tag: 'ok', value: o.value as Val };
    if (o.tag === 'throw' && typeof o.message === 'string') return { tag: 'throw', message: o.message };
    if (o.tag === 'range-violation' && typeof o.detail === 'string') return { tag: 'range-violation', detail: o.detail };
  }
  return { tag: 'fault', detail: `unexpected Lean output: ${text.trim().slice(0, 200)}` };
}

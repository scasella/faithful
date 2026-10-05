/**
 * The translator's intermediate representation (IR): a small, typed, purely functional core between TypeScript and
 * its renderings (the Lean model, the Lean range-check twin, and later the SMT encoding).
 *
 * Design rules (keep them; other packages depend on this file):
 *  - Every expression carries its type `ty`. There is no implicit coercion anywhere: `"a" + 1` arrives as
 *    `strConcat("a", intToStr(1))`.
 *  - Mutation is gone: a TypeScript variable that is reassigned becomes a chain of `let`s (SSA). Loops become separate
 *    named, recursive `IrFunction`s (role `loop`) that take the loop-carried variables as parameters and return their
 *    final values (`state`), or a `Flow` when the loop body can `return`.
 *  - Control is explicit: `if`, `matchFlow` (did the loop return?), `matchList` (for...of, structural recursion).
 *  - `throw` is a node; a function whose body can reach a `throw` (or a call to a throwing function) has
 *    `throws = true` and is rendered in `Except String`.
 *  - Each operation's JavaScript meaning is fixed by `PRIM_DOC` below. Operations that can leave the model's total
 *    semantics in JavaScript (overflow past ±2^53, index out of bounds, division by zero, non-ASCII case mapping) are
 *    listed in `CHECKED_OPS`; the range-check twin and the TypeScript instrumentation both read that table.
 *  - Callbacks (`lam`) appear only as arguments of `map`/`filter`/`foldl`/`sortBy` primitives. They never throw and
 *    never call the function being translated.
 */
import type { Span, Ty } from './contracts.js';

/** IR types: the contract's value types plus two internal ones that never cross the JSON boundary. */
export type IrTy =
  | Ty
  /** Loop-carried state: rendered as `Unit` (0 elements), the element itself (1), or a right-nested product (n). */
  | { k: 'state'; elems: IrTy[] }
  /** Result of a loop that can `return`: `Faithful.Flow ret next`. */
  | { k: 'flow'; ret: IrTy; next: IrTy };

export interface Site {
  /** Source span of the TypeScript operation (for messages in range-violation details). */
  span: Span;
  /** Short text of the operation, e.g. `a + b`. */
  text: string;
}

export type PrimOp =
  // Integers (JS numbers restricted to integers; see docs/DESIGN.md "Integer semantics")
  | 'add' | 'sub' | 'mul' | 'neg'
  | 'tmod' // a % b  (truncated, sign of dividend)
  | 'fdiv' // Math.floor(a / b)
  | 'cdiv' // Math.ceil(a / b)
  | 'abs' | 'min' | 'max'
  // Comparisons. eq/ne on int, bool or string; lt/le/gt/ge on int or string (code-unit order).
  | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'
  // Booleans. and/or short-circuit: the second argument is evaluated only when needed.
  | 'and' | 'or' | 'not'
  // Strings (List Char, BMP)
  | 'strLen' | 'strConcat' | 'charAt' | 'strAt' | 'charCodeAt' | 'strSlice' | 'strSliceFrom' | 'strIndexOf'
  | 'split' | 'join' | 'toLower' | 'toUpper' | 'intToStr' | 'boolToStr'
  // Arrays (List)
  | 'len' | 'at' | 'slice' | 'sliceFrom' | 'concat' | 'indexOf' | 'includes'
  | 'map' | 'mapI' | 'filter' | 'filterI' | 'foldl' | 'foldlI' | 'sortBy';

/** One-line JavaScript meaning of every primitive (documentation, and the SMT encoder's checklist). */
export const PRIM_DOC: Record<PrimOp, string> = {
  add: 'a + b on integers', sub: 'a - b', mul: 'a * b', neg: '-a',
  tmod: 'a % b: truncated remainder, sign of the dividend (Int.tmod)',
  fdiv: 'Math.floor(a / b) (Int.fdiv)', cdiv: 'Math.ceil(a / b) = -floor(-a / b)',
  abs: 'Math.abs(a)', min: 'Math.min(a, b)', max: 'Math.max(a, b)',
  eq: 'a === b on int/bool/string', ne: 'a !== b', lt: 'a < b (int, or string by UTF-16 code units)', le: 'a <= b',
  gt: 'a > b', ge: 'a >= b',
  and: 'a && b on booleans (short-circuit)', or: 'a || b on booleans (short-circuit)', not: '!a on a boolean',
  strLen: 's.length (UTF-16 code units = chars for BMP text)', strConcat: 's + t', charAt: "s.charAt(i): '' out of range",
  strAt: 's[i] (undefined out of range: excluded by rangeOk)', charCodeAt: 's.charCodeAt(i) (NaN out of range: excluded)',
  strSlice: 's.slice(a, b)', strSliceFrom: 's.slice(a)', strIndexOf: 's.indexOf(t, pos) (pos defaults to 0)',
  split: 's.split(sep) without limit', join: 'xs.join(sep) on string[]', toLower: 's.toLowerCase() (ASCII only)',
  toUpper: 's.toUpperCase() (ASCII only)', intToStr: 'String(n) for an integer', boolToStr: 'String(b)',
  len: 'xs.length', at: 'xs[i] (undefined out of range: excluded by rangeOk)', slice: 'xs.slice(a, b)', sliceFrom: 'xs.slice(a)',
  concat: 'xs.concat(ys) with ys an array of the same type', indexOf: 'xs.indexOf(x) on primitives (===)',
  includes: 'xs.includes(x) on primitives', map: 'xs.map(x => f)', mapI: 'xs.map((x, i) => f)',
  filter: 'xs.filter(x => p)', filterI: 'xs.filter((x, i) => p)', foldl: 'xs.reduce((acc, x) => f, init)',
  foldlI: 'xs.reduce((acc, x, i) => f, init)',
  sortBy: 'copy.sort(cmp) for a comparator read as "ascending/descending by key": stable (List.mergeSort)',
};

export type CheckKind =
  /** The integer result must lie within ±2^53 (inclusive), computed exactly. */
  | 'range'
  /** The second argument (divisor) must be non-zero. */
  | 'nonzero'
  /** The index (second argument) must satisfy 0 <= i < length of the first argument. */
  | 'bounds'
  /** The string argument must be ASCII (the model case-maps ASCII letters only). */
  | 'ascii'
  /** The resulting string has at most `MAX_STRING_LENGTH` UTF-16 code units (V8 throws RangeError on long strings). */
  | 'length';

/**
 * The single table of checked operations. The Lean range-check twin (`<fn>_chk`) and the TypeScript instrumentation
 * (`instrumentedTs`) both enforce exactly these checks, at exactly these operations, in evaluation order.
 * `ts` names the helper on the `__faithful` runtime object (see instrument.ts).
 */
export const CHECKED_OPS: Partial<Record<PrimOp, { kind: CheckKind; ts: string }>> = {
  add: { kind: 'range', ts: 'add' },
  sub: { kind: 'range', ts: 'sub' },
  mul: { kind: 'range', ts: 'mul' },
  tmod: { kind: 'nonzero', ts: 'mod' },
  fdiv: { kind: 'nonzero', ts: 'floorDiv' },
  cdiv: { kind: 'nonzero', ts: 'ceilDiv' },
  at: { kind: 'bounds', ts: 'at' },
  strAt: { kind: 'bounds', ts: 'at' },
  charCodeAt: { kind: 'bounds', ts: 'charCodeAt' },
  toLower: { kind: 'ascii', ts: 'lower' },
  toUpper: { kind: 'ascii', ts: 'upper' },
  // red-team round 2, r2StrLengthLimit. `split`, `slice`, `charAt`, case maps and number/boolean conversions cannot
  // produce a string longer than one that already exists, so only concatenation (`+`, `+=`, template literals) and
  // `join` are checked. A template literal is one check on its whole result (see `checkOf`).
  strConcat: { kind: 'length', ts: 'concat' },
  join: { kind: 'length', ts: 'join' },
};

/**
 * The check an IR primitive carries: its `CHECKED_OPS` entry, except for a `strConcat` marked `unchecked`. Those are
 * the inner concatenations of a template literal: JavaScript evaluates every substitution first and concatenates once,
 * so only the outermost concatenation of the chain is checked (inner results are prefixes of it, so the verdict is the
 * same, and the check runs after all substitutions, in JavaScript order). Every consumer of the table (the twin, the
 * instrumentation via `collectChecked`) must go through this function.
 */
export function checkOf(e: Expr): { kind: CheckKind; ts: string } | undefined {
  if (e.e !== 'prim' || e.unchecked) return undefined;
  return CHECKED_OPS[e.op];
}

/**
 * String length bound L, part of the `range-ok` precondition (red-team round 2, r2StrLengthLimit): every string built
 * by concatenation or `join` has at most L UTF-16 code units. V8 (Node v25.8.1) throws `RangeError: Invalid string
 * length` beyond 2^29 - 24 units; the Lean model is total. L = 2^24 is far below the engine limit (so the TypeScript
 * check, made before concatenating, always fires first) and keeps the Lean twin evaluable: building a 2^24-element
 * `List Char` by doubling takes about 0.4 s in `#eval` (measured; NOTES.md "String length").
 */
export const MAX_STRING_LENGTH = 16777216;

/**
 * Recursion-depth bound D, part of the `range-ok` precondition (red-team round 1, stackDepth): a self-call is inside
 * the model only when the calling activation has depth < D (the top-level call has depth 1), so at most D activations
 * of the function are live at once. V8 throws `RangeError: Maximum call stack size exceeded` at a depth that depends on
 * the frame size and the stack size; the Lean model is total and would otherwise claim a value there. Checked by the
 * `_chk` twin (`Faithful.ck (decide (τd < D))` before each self-call) and by the TS runtime helper `rec`.
 * Value chosen from measurements; see NOTES.md "Recursion depth".
 */
export const MAX_RECURSION_DEPTH = 500;

export interface IrParam {
  name: string;
  ty: IrTy;
}

export type Expr =
  | { e: 'int'; ty: IrTy; value: bigint }
  | { e: 'bool'; ty: IrTy; value: boolean }
  | { e: 'str'; ty: IrTy; value: string }
  | { e: 'var'; ty: IrTy; name: string }
  | { e: 'let'; ty: IrTy; name: string; value: Expr; body: Expr }
  /** Destructure a `state` value into names (0..n of them). */
  | { e: 'letState'; ty: IrTy; names: IrParam[]; value: Expr; body: Expr }
  | { e: 'if'; ty: IrTy; cond: Expr; then: Expr; else: Expr }
  /** `unchecked`: an inner `strConcat` of a template literal (see `checkOf`). */
  | { e: 'prim'; ty: IrTy; op: PrimOp; args: Expr[]; site?: Site; sort?: SortSpec; unchecked?: true }
  /** Call of an IR function of the same program (the translated function itself, or a loop function). */
  /** `site` is set on self-calls of the main function (the recursion-depth check reports it). */
  | { e: 'call'; ty: IrTy; fn: string; args: Expr[]; site?: Site }
  | { e: 'state'; ty: IrTy; elems: Expr[] }
  | { e: 'tuple'; ty: IrTy; elems: Expr[] }
  | { e: 'proj'; ty: IrTy; tuple: Expr; index: number }
  | { e: 'record'; ty: IrTy; fields: Array<{ name: string; value: Expr }> }
  | { e: 'field'; ty: IrTy; rec: Expr; name: string }
  | { e: 'list'; ty: IrTy; elems: Expr[] }
  | { e: 'some'; ty: IrTy; value: Expr }
  | { e: 'none'; ty: IrTy }
  | { e: 'throw'; ty: IrTy; message: string }
  | { e: 'lam'; ty: IrTy; params: IrParam[]; body: Expr }
  | { e: 'flowRet'; ty: IrTy; value: Expr }
  | { e: 'flowNext'; ty: IrTy; value: Expr }
  | { e: 'matchFlow'; ty: IrTy; scrut: Expr; retVar: IrParam; onRet: Expr; nextNames: IrParam[]; onNext: Expr }
  | { e: 'matchList'; ty: IrTy; scrut: Expr; onNil: Expr; head: IrParam; tail: IrParam; onCons: Expr };

/** How a recognized comparator orders elements: by `key(x)` (int or string), ascending or descending, stably. */
export interface SortSpec {
  key: Expr & { e: 'lam' };
  keyTy: 'int' | 'string';
  descending: boolean;
}

/** Hints the Lean emitter turns into `have` lines in `decreasing_by`. */
export type MeasureHint =
  /** `Faithful.fdiv_lt_self`: the measured variable `v` is replaced by `Math.floor(v / k)`, k >= 2. */
  | { kind: 'fdiv'; param: string; k: bigint }
  /** `Faithful.sliceFrom_length_lt`: the measured array/string `v` is replaced by `v.slice(k)`, k >= 1. */
  | { kind: 'slice'; param: string; k: bigint };

export type Measure =
  /** for...of: structural on the remaining list parameter (`termination_by param.length`). */
  | { kind: 'list-length'; param: string; pattern: string }
  /** `termination_by expr.toNat` for an Int-valued `expr` over the parameters. */
  | { kind: 'int'; expr: Expr; pattern: string; hints: MeasureHint[]; unlet?: boolean }
  /** `termination_by param.length` for a shrinking array/string parameter. */
  | { kind: 'length'; param: string; pattern: string; hints: MeasureHint[]; unlet?: boolean };
/*
 * `unlet` (red-team round 2, r2RecGuardBoolLocal): a guard that justifies the measure goes through a `let`-bound name
 * (`const done = n <= 0; if (done) ...`). The measure finder inlines lets, but in `decreasing_by` the hypothesis is
 * `¬ done = true` with `done : Bool := decide (n ≤ 0)` a let variable, which omega cannot see through. The emitter then
 * starts `decreasing_by` with `faithful_unlet` (Core.lean), which unfolds let variables into the hypotheses.
 */

export interface IrFunction {
  /** Lean short name inside `namespace Model`. */
  name: string;
  role: 'main' | 'loop';
  params: IrParam[];
  /** Value type (the Lean type is `Except String ret` when `throws`). */
  ret: IrTy;
  throws: boolean;
  body: Expr;
  /** `null` when the function does not call itself. */
  measure: Measure | null;
}

export interface RecordDecl {
  /** Lean structure name (short, inside `namespace Model`). */
  name: string;
  /** Shape key (see `recordKey`). */
  key: string;
  fields: Array<{ name: string; lean: string; ty: Ty }>;
}

export interface IrProgram {
  /** The TypeScript function name. */
  fnName: string;
  /** Lean short name of the main function. */
  leanName: string;
  params: IrParam[];
  ret: Ty;
  throws: boolean;
  records: RecordDecl[];
  /** In dependency order: every function appears after the functions it calls (except itself). Main is last. */
  functions: IrFunction[];
}

/** Structural key of a type (records are compared by field names and types, as TypeScript does). */
export function tyKey(t: IrTy): string {
  switch (t.k) {
    case 'int':
    case 'bool':
    case 'string':
      return t.k;
    case 'array':
      return `${tyKey(t.elem)}[]`;
    case 'tuple':
      return `[${t.elems.map(tyKey).join(',')}]`;
    case 'record':
      return recordKey(t);
    case 'option':
      return `${tyKey(t.inner)}?`;
    case 'state':
      return `state(${t.elems.map(tyKey).join(',')})`;
    case 'flow':
      return `flow(${tyKey(t.ret)};${tyKey(t.next)})`;
  }
}

export function recordKey(t: { fields: Array<{ name: string; ty: Ty }> }): string {
  return `{${[...t.fields].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((f) => `${f.name}:${tyKey(f.ty)}`).join(',')}}`;
}

export function tyEq(a: IrTy, b: IrTy): boolean {
  return tyKey(a) === tyKey(b);
}

export const INT: Ty = { k: 'int' };
export const BOOL: Ty = { k: 'bool' };
export const STR: Ty = { k: 'string' };

/** Pre-order walk over an expression tree. */
export function walkExpr(e: Expr, f: (e: Expr) => void): void {
  f(e);
  for (const c of children(e)) walkExpr(c, f);
}

export function children(e: Expr): Expr[] {
  switch (e.e) {
    case 'int':
    case 'bool':
    case 'str':
    case 'var':
    case 'none':
    case 'throw':
      return [];
    case 'let':
      return [e.value, e.body];
    case 'letState':
      return [e.value, e.body];
    case 'if':
      return [e.cond, e.then, e.else];
    case 'prim':
      return e.sort ? [...e.args, e.sort.key] : e.args;
    case 'call':
      return e.args;
    case 'state':
    case 'tuple':
    case 'list':
      return e.elems;
    case 'proj':
      return [e.tuple];
    case 'record':
      return e.fields.map((f) => f.value);
    case 'field':
      return [e.rec];
    case 'some':
    case 'flowRet':
    case 'flowNext':
      return [e.value];
    case 'lam':
      return [e.body];
    case 'matchFlow':
      return [e.scrut, e.onRet, e.onNext];
    case 'matchList':
      return [e.scrut, e.onNil, e.onCons];
  }
}

/** Number of nodes (used to bound continuation duplication). */
export function exprSize(e: Expr): number {
  let n = 0;
  walkExpr(e, () => n++);
  return n;
}

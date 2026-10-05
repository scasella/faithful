/**
 * Contracts shared by translate, engine, smt and prover. Types only; no behavior.
 * Design rationale: docs/DESIGN.md. Change these only together with that document.
 */

/** Subset-level types. `number` is always `int` here: non-integer numbers are refused. */
export type Ty =
  | { k: 'int' }
  | { k: 'bool' }
  | { k: 'string' }
  | { k: 'array'; elem: Ty }
  | { k: 'tuple'; elems: Ty[] }
  | { k: 'record'; fields: Array<{ name: string; ty: Ty }> }
  /** Only as a return type (or inside one). `null`/`undefined` in TS. The inner type is never itself an option. */
  | { k: 'option'; inner: Ty };

/**
 * JSON value domain used on BOTH sides of every comparison.
 *   int -> number (integer, |n| <= 2^53), bool -> boolean, string -> string (BMP text), array/tuple -> array,
 *   record -> object with the declared field names, option -> null (none) or the inner value (some).
 */
export type Val = number | boolean | string | null | Val[] | { [field: string]: Val };

/** Result of running the original, a candidate, or the Lean model on one input. */
export type Outcome =
  | { tag: 'ok'; value: Val }
  /** `throw new Error("literal")` or `throw "literal"`: modeled as `Except.error message`. */
  | { tag: 'throw'; message: string }
  /**
   * The range-instrumented original left +-2^53, produced a non-integer, indexed out of range, divided by zero, recursed
   * deeper than `MAX_RECURSION_DEPTH` (ir.ts), built a string longer than `MAX_STRING_LENGTH` (ir.ts), or (detail
   * `ascii ...`) case-mapped a non-ASCII string: the input violates
   * the `rangeOk` (or `asciiOk`) precondition.
   */
  | { tag: 'range-violation'; detail: string }
  /** Timeout, stack overflow, or a thrown non-literal error. Never counted as agreement. */
  | { tag: 'fault'; detail: string };

export interface Param {
  name: string;
  ty: Ty;
}

export interface Span {
  /** UTF-16 offsets into the source text handed to the translator. */
  start: number;
  end: number;
  /** 1-based. */
  line: number;
  column: number;
}

/** Why a function is outside the verifiable subset. */
export type RefusalCode =
  | 'float' // non-integer division, Math.sqrt, parseFloat, a number not provably integer-valued
  | 'regex'
  | 'date'
  | 'map-set'
  | 'dictionary'
  | 'nan'
  | 'io'
  | 'random'
  | 'async'
  | 'generic'
  | 'bitwise'
  | 'this'
  | 'mutable-capture' // closure over mutable state, or a free variable that is not a pure function in scope
  | 'no-termination-measure' // `while` or recursion with no measure the translator can find
  | 'unsupported-type'
  | 'unsupported-syntax'
  | 'unsupported-library'
  | 'missing-annotation'
  | 'non-bmp'
  | 'not-found'; // function name not exported / not present

export interface Refusal {
  code: RefusalCode;
  /** Plain-words reason shown to the user. */
  reason: string;
  span: Span;
}

export type PreconditionKind =
  /** Every `number` parameter is an integer with |n| <= 2^53. */
  | 'int-bound'
  /** Every `string` parameter (and every string element) is Basic Multilingual Plane text. */
  | 'bmp'
  /**
   * The generated `rangeOk` function: every intermediate value of the original is an integer within +-2^53, no array
   * index or `charCodeAt` is out of bounds, no division or `%` by zero, no string built by concatenation or `join` is
   * longer than `MAX_STRING_LENGTH` (ir.ts) UTF-16 units. In other words, the JS execution never leaves the
   * model's total semantics (no NaN, no `undefined`, no Infinity). For a self-recursive function also: at most
   * `MAX_RECURSION_DEPTH` (ir.ts) activations are live at once (deeper recursion can exhaust the JavaScript stack).
   */
  | 'range-ok'
  /** Strings that reach `toLowerCase`/`toUpperCase` are ASCII: the Lean model maps ASCII letters only (documented gap). */
  | 'ascii'
  /** The user chose to treat a `throw` as a precondition: the function does not throw on valid inputs. */
  | 'no-throw'
  /** A carve-out the user recorded after ruling "my function is wrong". Shown prominently forever. */
  | 'carve-out';

export interface Precondition {
  id: string;
  kind: PreconditionKind;
  /** Plain words for the agreement screen. */
  words: string;
  /** Lean `Bool` expression over the parameter names (and `Model.<fn>_rangeOk` for `range-ok`). */
  lean: string;
  /**
   * JS boolean expression over the parameter names, for generators and the differential tester.
   * `range-ok` has no tsExpr: it is enforced by running the instrumented original (outcome `range-violation`).
   */
  ts?: string;
}

export interface ThrowSite {
  message: string;
  span: Span;
}

export interface LeanModel {
  /** Complete Lean text of the model (starts with `import Faithful.Core`), safe to prepend to a theorem file. */
  source: string;
  /** Fully qualified Lean names. */
  names: { original: string; rangeOk: string; pre: string };
  /** Lean type text of each parameter, in order, and of the result (`Except String α` when `canThrow`). */
  paramTypes: string[];
  /** (Additive.) Lean binder name of each parameter, in order (TS names sanitized: `max` -> `max_`, ...). */
  paramNames?: string[];
  retType: string;
  /** SHA-256 of `source`. */
  hash: string;
  /**
   * (Additive.) Lean structures emitted for the record types of this function: shape key (see `recordKey` in ir.ts),
   * structure name inside `namespace Model`, and fields (TypeScript name, Lean name, type). Needed to build Lean values.
   */
  records?: Array<{ key: string; name: string; fields: Array<{ name: string; lean: string; ty: Ty }> }>;
}

export interface Translation {
  ok: true;
  fnName: string;
  params: Param[];
  ret: Ty;
  canThrow: boolean;
  throwSites: ThrowSite[];
  lean: LeanModel;
  preconditions: Precondition[];
  /** The function's source text exactly as given, and its hash. */
  source: { text: string; hash: string };
  /**
   * (Additive.) The plain original as a self-contained unit for running it: the module-level constants the function
   * reads (their statements verbatim, possibly with `export`), then `source.text`. `source.text` alone does not run
   * when the function reads a module constant. Absent in translations stored before this field existed.
   */
  plainTs?: string;
  /** The same function with every arithmetic result wrapped in a range check; see docs/DESIGN.md "Range checks". */
  instrumentedTs: string;
  /** Documented semantic gaps this particular function touches (e.g. `UTF-16 gap`, `sort stability`). */
  notes: string[];
}

export interface TranslationRefused {
  ok: false;
  fnName: string;
  refusal: Refusal;
}

export type TranslationResult = Translation | TranslationRefused;

/** Statistic kept over a corpus or a library sample: how often each refusal reason occurs. */
export type RefusalStats = Record<RefusalCode, number>;

/** The integer bound the whole tool assumes for `number`. */
export const MAX_SAFE = 9007199254740992; // 2^53

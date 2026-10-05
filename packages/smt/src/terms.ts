/**
 * SMT-LIB 2 term construction with light, exact constant folding, and the `Smt` script builder.
 *
 * Terms are plain strings. Folding is limited to what is trivially exact: boolean connectives with literal operands,
 * `ite` with a literal condition or identical branches, and + - * and comparisons of two integer literals (BigInt).
 * Division and remainder are never folded here (they always reach Z3; see `intsem.ts`).
 *
 * `Smt.def` names every non-atomic term with a fresh constant and an equality assertion. Every definition is total and
 * deterministic, so naming is exact; it keeps the script a DAG instead of an exponentially large tree.
 */

export type T = string;
export type Sort = 'Int' | 'Bool';

export const TRUE: T = 'true';
export const FALSE: T = 'false';

/** Raised when an encoding exceeds the size budget. Never a claim: the caller reports "did not complete". */
export class TooLarge extends Error {
  constructor(what: string) {
    super(`encoding too large: ${what}`);
    this.name = 'TooLarge';
  }
}

/** Raised for an IR construct the encoder cannot encode exactly. The stage reports `unsupported: <construct>`. */
export class Unsupported extends Error {
  constructor(readonly construct: string) {
    super(`unsupported: ${construct}`);
    this.name = 'Unsupported';
  }
}

export function int(n: bigint | number): T {
  const b = typeof n === 'bigint' ? n : BigInt(n);
  return b < 0n ? `(- ${-b})` : `${b}`;
}

const LIT_POS = /^\d+$/;
const LIT_NEG = /^\(- (\d+)\)$/;

export function litInt(t: T): bigint | null {
  if (LIT_POS.test(t)) return BigInt(t);
  const m = LIT_NEG.exec(t);
  return m ? -BigInt(m[1]!) : null;
}

export function isAtom(t: T): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.!]*$/.test(t) || litInt(t) !== null;
}

export function not(a: T): T {
  if (a === TRUE) return FALSE;
  if (a === FALSE) return TRUE;
  const m = /^\(not (.*)\)$/s.exec(a);
  if (m && balanced(m[1]!)) return m[1]!;
  return `(not ${a})`;
}

function balanced(s: string): boolean {
  let d = 0;
  for (const ch of s) {
    if (ch === '(') d++;
    else if (ch === ')') {
      d--;
      if (d < 0) return false;
    }
  }
  return d === 0;
}

export function and(...xs: T[]): T {
  const ys: T[] = [];
  for (const x of xs) {
    if (x === FALSE) return FALSE;
    if (x !== TRUE && !ys.includes(x)) ys.push(x);
  }
  if (ys.length === 0) return TRUE;
  if (ys.length === 1) return ys[0]!;
  return `(and ${ys.join(' ')})`;
}

export function or(...xs: T[]): T {
  const ys: T[] = [];
  for (const x of xs) {
    if (x === TRUE) return TRUE;
    if (x !== FALSE && !ys.includes(x)) ys.push(x);
  }
  if (ys.length === 0) return FALSE;
  if (ys.length === 1) return ys[0]!;
  return `(or ${ys.join(' ')})`;
}

export function implies(a: T, b: T): T {
  return or(not(a), b);
}

export function ite(c: T, a: T, b: T): T {
  if (c === TRUE) return a;
  if (c === FALSE) return b;
  if (a === b) return a;
  if (a === TRUE && b === FALSE) return c;
  if (a === FALSE && b === TRUE) return not(c);
  return `(ite ${c} ${a} ${b})`;
}

export function eq(a: T, b: T): T {
  if (a === b) return TRUE;
  const x = litInt(a);
  const y = litInt(b);
  if (x !== null && y !== null) return x === y ? TRUE : FALSE;
  if ((a === TRUE || a === FALSE) && (b === TRUE || b === FALSE)) return a === b ? TRUE : FALSE;
  if (a === TRUE) return b;
  if (b === TRUE) return a;
  if (a === FALSE) return not(b);
  if (b === FALSE) return not(a);
  return `(= ${a} ${b})`;
}

export function ne(a: T, b: T): T {
  return not(eq(a, b));
}

function cmp(op: '<' | '<=', a: T, b: T): T {
  const x = litInt(a);
  const y = litInt(b);
  if (x !== null && y !== null) return (op === '<' ? x < y : x <= y) ? TRUE : FALSE;
  if (a === b) return op === '<' ? FALSE : TRUE;
  return `(${op} ${a} ${b})`;
}

export const lt = (a: T, b: T): T => cmp('<', a, b);
export const le = (a: T, b: T): T => cmp('<=', a, b);
export const gt = (a: T, b: T): T => cmp('<', b, a);
export const ge = (a: T, b: T): T => cmp('<=', b, a);

/** `x + c` in canonical form so that `(n - 1) - 1` and `n - 2` print identically (helps call memoization). */
function splitOffset(t: T): { base: T | null; off: bigint } {
  const l = litInt(t);
  if (l !== null) return { base: null, off: l };
  const m = /^\(\+ ([A-Za-z_][A-Za-z0-9_.!]*) (\d+|\(- \d+\))\)$/.exec(t);
  if (m) return { base: m[1]!, off: litInt(m[2]!)! };
  return { base: t, off: 0n };
}

function withOffset(base: T | null, off: bigint): T {
  if (base === null) return int(off);
  if (off === 0n) return base;
  if (isAtom(base)) return `(+ ${base} ${int(off)})`;
  return off < 0n ? `(- ${base} ${-off})` : `(+ ${base} ${off})`;
}

export function add(a: T, b: T): T {
  const x = splitOffset(a);
  const y = splitOffset(b);
  if (y.base === null) return withOffset(x.base, x.off + y.off);
  if (x.base === null) return withOffset(y.base, x.off + y.off);
  return `(+ ${a} ${b})`;
}

export function sub(a: T, b: T): T {
  const y = litInt(b);
  if (y !== null) return add(a, int(-y));
  if (a === b) return '0';
  return `(- ${a} ${b})`;
}

export function neg(a: T): T {
  const x = litInt(a);
  if (x !== null) return int(-x);
  return `(- ${a})`;
}

export function mul(a: T, b: T): T {
  const x = litInt(a);
  const y = litInt(b);
  if (x !== null && y !== null) return int(x * y);
  if (x === 0n || y === 0n) return '0';
  if (x === 1n) return b;
  if (y === 1n) return a;
  return `(* ${a} ${b})`;
}

export function sum(xs: T[]): T {
  let acc: T = '0';
  for (const x of xs) acc = add(acc, x);
  return acc;
}

export function b2i(c: T): T {
  return ite(c, '1', '0');
}

export function minT(a: T, b: T): T {
  return ite(le(a, b), a, b);
}

export function maxT(a: T, b: T): T {
  return ite(ge(a, b), a, b);
}

export interface SmtLimits {
  /** Maximum number of characters of the script. Default 60,000,000. */
  maxChars?: number;
}

/** One SMT-LIB 2 script under construction. */
export class Smt {
  readonly lines: string[] = [];
  private n = 0;
  private chars = 0;
  private readonly memo = new Map<string, string>();
  readonly maxChars: number;

  constructor(limits: SmtLimits = {}) {
    this.maxChars = limits.maxChars ?? 60_000_000;
  }

  get size(): number {
    return this.chars;
  }

  get defs(): number {
    return this.n;
  }

  emit(line: string): void {
    this.lines.push(line);
    this.chars += line.length + 1;
    if (this.chars > this.maxChars) throw new TooLarge(`more than ${this.maxChars} characters of SMT-LIB`);
  }

  fresh(sort: Sort, hint = 'v'): T {
    const name = `${hint}!${++this.n}`;
    this.emit(`(declare-const ${name} ${sort})`);
    return name;
  }

  /** A name for `term` (atomic terms are returned as they are). Identical terms share one name. */
  def(sort: Sort, term: T): T {
    if (isAtom(term) || term === TRUE || term === FALSE) return term;
    const hit = this.memo.get(term);
    if (hit) return hit;
    const name = `d!${++this.n}`;
    this.emit(`(declare-const ${name} ${sort})`);
    this.emit(`(assert (= ${name} ${term}))`);
    this.memo.set(term, name);
    return name;
  }

  assert(t: T): void {
    if (t === TRUE) return;
    this.emit(`(assert ${t})`);
  }

  text(): string {
    return this.lines.join('\n');
  }
}

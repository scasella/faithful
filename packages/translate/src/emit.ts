/**
 * IR -> Lean 4.
 *
 * Three renderings of the same IR functions:
 *  - the model `Model.<f>` (pure, or `Except String` when it can throw);
 *  - the checked twin `Model.<f>_chk : ... -> Faithful.Chk τ`, which mirrors the control structure and stops at the
 *    first operation listed in `CHECKED_OPS` (through `checkOf`) whose check fails (range, bounds, non-zero divisor,
 *    ASCII, string length);
 *  - `Model.<f>_rangeOk`, `Model.<f>_asciiOk` (Bool, read off the twin) and `Model.<f>_pre` (all preconditions).
 *
 * Monadic code is emitted as `do` blocks in A-normal form: effectful calls and checks are separate lines evaluated in
 * JavaScript order; the values themselves stay pure Lean expressions (so termination proofs see `i + 1`, not an opaque
 * bound variable). `if` conditions are emitted as decidable Props so `decreasing_by` gets usable hypotheses.
 */
import type { Ty } from './contracts.js';
import { MAX_RECURSION_DEPTH, MAX_STRING_LENGTH, checkOf, recordKey, walkExpr, type Expr, type IrFunction, type IrProgram, type IrTy, type Measure, type RecordDecl } from './ir.js';

export interface LeanCtx {
  records: Map<string, RecordDecl>;
}

export function recordsMap(records: Array<RecordDecl | { key: string; name: string; fields?: unknown }>): Map<string, RecordDecl> {
  return new Map(records.map((r) => [r.key, r as RecordDecl]));
}

export function leanTy(t: IrTy, c: LeanCtx): string {
  switch (t.k) {
    case 'int':
      return 'Int';
    case 'bool':
      return 'Bool';
    case 'string':
      return 'List Char';
    case 'array':
      return `List (${leanTy(t.elem, c)})`;
    case 'tuple':
      return `(${t.elems.map((e) => leanTy(e, c)).join(' × ')})`;
    case 'record': {
      const r = c.records.get(recordKey(t));
      if (!r) throw new Error(`internal: unknown record ${recordKey(t)}`);
      return `Model.${r.name}`;
    }
    case 'option':
      return `Option (${leanTy(t.inner, c)})`;
    case 'state':
      return t.elems.length === 0 ? 'Unit' : t.elems.length === 1 ? leanTy(t.elems[0]!, c) : `(${t.elems.map((e) => leanTy(e, c)).join(' × ')})`;
    case 'flow':
      return `(Faithful.Flow (${leanTy(t.ret, c)}) (${leanTy(t.next, c)}))`;
  }
}

/** Lean string literal. */
export function leanStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return out + '"';
}

/** Lean `Char` literal for one BMP, non-surrogate UTF-16 code unit. */
export function leanChar(code: number): string {
  if (code >= 0xd800 && code <= 0xdfff) throw new Error(`lone surrogate U+${code.toString(16)} cannot be a Lean Char (bmp precondition)`);
  const ch = String.fromCharCode(code);
  if (ch === "'") return "'\\''";
  if (ch === '\\') return "'\\\\'";
  if (ch === '\n') return "'\\n'";
  if (ch === '\t') return "'\\t'";
  if (ch === '\r') return "'\\r'";
  if (code >= 0x20 && code < 0x7f) return `'${ch}'`;
  return `'\\u${code.toString(16).padStart(4, '0')}'`;
}

/** Lean `List Char` literal for a JS string (UTF-16 code units; must be BMP text). */
export function leanStrList(s: string): string {
  if (s.length === 0) return '([] : List Char)';
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) parts.push(leanChar(s.charCodeAt(i)));
  return `[${parts.join(', ')}]`;
}

export function leanInt(v: bigint | number): string {
  return `(${v.toString()} : Int)`;
}

/** Projection path for element `i` of an `n`-tuple (right-nested product). */
export function tupleProj(base: string, i: number, n: number): string {
  let s = base;
  for (let j = 0; j < i; j++) s += '.2';
  if (i < n - 1) s += '.1';
  return s;
}

/** Type-directed JSON encoder (a Lean function `T -> Lean.Json`). */
export function encoder(t: Ty, c: LeanCtx): string {
  switch (t.k) {
    case 'int':
      return 'Faithful.jInt';
    case 'bool':
      return 'Faithful.jBool';
    case 'string':
      return 'Faithful.jStr';
    case 'array':
      return `(Faithful.jList ${encoder(t.elem, c)})`;
    case 'tuple':
      return `(fun (p : ${leanTy(t, c)}) => Lean.Json.arr #[${t.elems.map((e, i) => `${encoder(e, c)} ${tupleProj('p', i, t.elems.length)}`).join(', ')}])`;
    case 'record':
      return '(fun r => Lean.toJson r)';
    case 'option':
      return `(Faithful.jOpt ${encoder(t.inner, c)})`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pure rendering
// ---------------------------------------------------------------------------------------------------------------

const PAD = (n: number): string => ' '.repeat(n);

class Printer {
  private tmp = 0;
  constructor(
    readonly c: LeanCtx,
    /** Lean reference for a call of IR function `fn` (model or chk name). */
    readonly callName: (fn: string) => string,
  ) {}

  freshTmp(): string {
    return `τ${++this.tmp}`;
  }

  /** Pure Lean term for `e` (a value). `d` = indentation for continuation lines. */
  P(e: Expr, d: number): string {
    switch (e.e) {
      case 'int':
        return leanInt(e.value);
      case 'bool':
        return e.value ? 'true' : 'false';
      case 'str':
        return leanStrList(e.value);
      case 'var':
        return e.name;
      case 'let':
        return `(let ${e.name} := ${this.P(e.value, d + 4)};\n${PAD(d + 1)}${this.P(e.body, d + 1)})`;
      case 'letState':
        if (e.names.length === 0) return this.P(e.body, d);
        return `(let ${pattern(e.names.map((n) => n.name))} := ${this.P(e.value, d + 4)};\n${PAD(d + 1)}${this.P(e.body, d + 1)})`;
      case 'if':
        return `(if ${this.C(e.cond, d + 4)} then\n${PAD(d + 2)}${this.P(e.then, d + 2)}\n${PAD(d + 1)}else\n${PAD(d + 2)}${this.P(e.else, d + 2)})`;
      case 'prim':
        return this.prim(e, d);
      case 'call':
        return `(${this.callName(e.fn)}${e.args.map((a) => ' ' + this.P(a, d + 2)).join('')})`;
      case 'state':
        return e.elems.length === 0 ? '()' : e.elems.length === 1 ? this.P(e.elems[0]!, d) : `(${e.elems.map((x) => this.P(x, d + 1)).join(', ')})`;
      case 'tuple':
        return `(${e.elems.map((x) => this.P(x, d + 1)).join(', ')})`;
      case 'proj': {
        const n = (e.tuple.ty as Extract<Ty, { k: 'tuple' }>).elems.length;
        return tupleProj(atomic(this.P(e.tuple, d)), e.index, n);
      }
      case 'record': {
        const r = this.c.records.get(recordKey(e.ty as Extract<Ty, { k: 'record' }>))!;
        const fs = e.fields.map((f) => `${r.fields.find((x) => x.name === f.name)!.lean} := ${this.P(f.value, d + 4)}`);
        return `({ ${fs.join(', ')} } : Model.${r.name})`;
      }
      case 'field': {
        const r = this.c.records.get(recordKey(e.rec.ty as Extract<Ty, { k: 'record' }>))!;
        return `${atomic(this.P(e.rec, d))}.${r.fields.find((x) => x.name === e.name)!.lean}`;
      }
      case 'list':
        return `([${e.elems.map((x) => this.P(x, d + 2)).join(', ')}] : ${leanTy(e.ty, this.c)})`;
      case 'some':
        return `(some ${this.P(e.value, d + 2)})`;
      case 'none':
        return `(none : ${leanTy(e.ty, this.c)})`;
      case 'flowRet':
        return `(Faithful.Flow.ret ${this.P(e.value, d + 2)})`;
      case 'flowNext':
        return `(Faithful.Flow.next ${this.P(e.value, d + 2)})`;
      case 'lam':
        return `(fun ${e.params.map((p) => `(${p.name} : ${leanTy(p.ty, this.c)})`).join(' ')} =>\n${PAD(d + 2)}${this.P(e.body, d + 2)})`;
      case 'matchFlow':
        return (
          `(match ${this.P(e.scrut, d + 6)} with\n` +
          `${PAD(d + 1)}| .ret ${e.retVar.name} =>\n${PAD(d + 4)}${this.P(e.onRet, d + 4)}\n` +
          `${PAD(d + 1)}| .next ${pattern(e.nextNames.map((n) => n.name))} =>\n${PAD(d + 4)}${this.P(e.onNext, d + 4)})`
        );
      case 'matchList':
        return (
          `(match ${this.P(e.scrut, d + 6)} with\n` +
          `${PAD(d + 1)}| [] =>\n${PAD(d + 4)}${this.P(e.onNil, d + 4)}\n` +
          `${PAD(d + 1)}| ${e.head.name} :: ${e.tail.name} =>\n${PAD(d + 4)}${this.P(e.onCons, d + 4)})`
        );
      case 'throw':
        throw new Error('internal: throw in a pure rendering');
    }
  }

  /** Decidable Prop for a Bool-typed expression (used in `if` conditions). */
  C(e: Expr, d: number): string {
    if (e.e === 'bool') return e.value ? 'True' : 'False';
    if (e.e === 'prim') {
      const [a, b] = e.args;
      const isStr = a?.ty.k === 'string';
      switch (e.op) {
        case 'and':
          return `(${this.C(a!, d)} ∧ ${this.C(b!, d)})`;
        case 'or':
          return `(${this.C(a!, d)} ∨ ${this.C(b!, d)})`;
        case 'not':
          return `(¬ ${this.C(a!, d)})`;
        case 'eq':
          return `(${this.P(a!, d)} = ${this.P(b!, d)})`;
        case 'ne':
          return `(${this.P(a!, d)} ≠ ${this.P(b!, d)})`;
        case 'lt':
          return isStr ? `(Faithful.strLt ${this.P(a!, d)} ${this.P(b!, d)} = true)` : `(${this.P(a!, d)} < ${this.P(b!, d)})`;
        case 'le':
          return isStr ? `(Faithful.strLe ${this.P(a!, d)} ${this.P(b!, d)} = true)` : `(${this.P(a!, d)} ≤ ${this.P(b!, d)})`;
        case 'gt':
          return isStr ? `(Faithful.strLt ${this.P(b!, d)} ${this.P(a!, d)} = true)` : `(${this.P(a!, d)} > ${this.P(b!, d)})`;
        case 'ge':
          return isStr ? `(Faithful.strLe ${this.P(b!, d)} ${this.P(a!, d)} = true)` : `(${this.P(a!, d)} ≥ ${this.P(b!, d)})`;
        default:
          break;
      }
    }
    return `(${this.P(e, d)} = true)`;
  }

  private prim(e: Extract<Expr, { e: 'prim' }>, d: number): string {
    const a = e.args.map((x) => this.P(x, d + 2));
    const [x, y, z] = a;
    switch (e.op) {
      case 'add':
        return `(${x} + ${y})`;
      case 'sub':
        return `(${x} - ${y})`;
      case 'mul':
        return `(${x} * ${y})`;
      case 'neg':
        return `(-${x})`;
      case 'tmod':
        return `(Int.tmod ${x} ${y})`;
      case 'fdiv':
        return `(Int.fdiv ${x} ${y})`;
      case 'cdiv':
        return `(Faithful.cdiv ${x} ${y})`;
      case 'abs':
        return `(Faithful.iabs ${x})`;
      case 'min':
        return `(Min.min ${x} ${y})`;
      case 'max':
        return `(Max.max ${x} ${y})`;
      case 'eq':
      case 'ne':
      case 'lt':
      case 'le':
      case 'gt':
      case 'ge':
        if (e.args[0]!.ty.k === 'string' && e.op !== 'eq' && e.op !== 'ne') {
          const [p, q] = e.op === 'gt' || e.op === 'ge' ? [y, x] : [x, y];
          return `(Faithful.${e.op === 'lt' || e.op === 'gt' ? 'strLt' : 'strLe'} ${p} ${q})`;
        }
        return `(decide ${this.C(e, d)})`;
      case 'and':
        return `(${x} && ${y})`;
      case 'or':
        return `(${x} || ${y})`;
      case 'not':
        return `(!${x})`;
      case 'strLen':
      case 'len':
        return `((${x}).length : Int)`;
      case 'strConcat':
      case 'concat':
        return `(${x} ++ ${y})`;
      case 'charAt':
        return `(Faithful.charAt ${x} ${y})`;
      case 'strAt':
        return `(Faithful.strAt ${x} ${y})`;
      case 'charCodeAt':
        return `(Faithful.charCodeAt ${x} ${y})`;
      case 'strSlice':
      case 'slice':
        return `(Faithful.slice ${x} ${y} ${z})`;
      case 'strSliceFrom':
      case 'sliceFrom':
        return `(Faithful.sliceFrom ${x} ${y})`;
      case 'strIndexOf':
        return `(Faithful.strIndexOf ${x} ${y} ${z})`;
      case 'split':
        return `(Faithful.split ${x} ${y})`;
      case 'join':
        return `(Faithful.join ${x} ${y})`;
      case 'toLower':
        return `(Faithful.toLower ${x})`;
      case 'toUpper':
        return `(Faithful.toUpper ${x})`;
      case 'intToStr':
        return `(Faithful.intToStr ${x})`;
      case 'boolToStr':
        return `(Faithful.boolToStr ${x})`;
      case 'at':
        return `(Faithful.getD ${x} ${y})`;
      case 'indexOf':
        return `(Faithful.indexOf ${x} ${y})`;
      case 'includes':
        return `(Faithful.includes ${x} ${y})`;
      case 'map':
        return `(List.map ${y} ${x})`;
      case 'mapI':
        return `(Faithful.mapI ${y} ${x})`;
      case 'filter':
        return `(List.filter ${y} ${x})`;
      case 'filterI':
        return `(Faithful.filterI ${y} ${x})`;
      case 'foldl':
        return `(List.foldl ${y} ${z} ${x})`;
      case 'foldlI':
        return `(Faithful.foldlI ${y} ${z} ${x})`;
      case 'sortBy':
        return `(List.mergeSort ${x} ${this.sortLe(e)})`;
    }
  }

  sortLe(e: Extract<Expr, { e: 'prim' }>): string {
    const s = e.sort!;
    const p = s.key.params[0]!;
    const ka = this.P(substVar(s.key.body, p.name, 'a'), 0);
    const kb = this.P(substVar(s.key.body, p.name, 'b'), 0);
    const [l, r] = s.descending ? [kb, ka] : [ka, kb];
    const le = s.keyTy === 'int' ? `decide (${l} ≤ ${r})` : `Faithful.strLe ${l} ${r}`;
    return `(fun (a b : ${leanTy(p.ty, this.c)}) => ${le})`;
  }
}

function atomic(s: string): string {
  return /^[A-Za-z_τ][A-Za-z0-9_'.τ]*$/.test(s) || (s.startsWith('(') && balancedOuter(s)) ? s : `(${s})`;
}

function balancedOuter(s: string): boolean {
  if (!s.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return true;
}

function pattern(names: string[]): string {
  return names.length === 0 ? '_' : names.length === 1 ? names[0]! : `(${names.join(', ')})`;
}

export function substVar(e: Expr, from: string, to: string): Expr {
  switch (e.e) {
    case 'var':
      return e.name === from ? { ...e, name: to } : e;
    case 'field':
      return { ...e, rec: substVar(e.rec, from, to) };
    case 'proj':
      return { ...e, tuple: substVar(e.tuple, from, to) };
    default:
      return e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Monadic rendering (throwing model and checked twin)
// ---------------------------------------------------------------------------------------------------------------

type Mode = { kind: 'except'; throwing: Set<string> } | { kind: 'chk' };

class MPrinter extends Printer {
  constructor(
    c: LeanCtx,
    callName: (fn: string) => string,
    readonly mode: Mode,
    /** Checked twin of a self-recursive main function: its self-calls carry and check the depth parameter. */
    readonly depth?: { fn: string; param: string },
  ) {
    super(c, callName);
  }

  /** The depth check before a self-call (after its arguments are evaluated, as in JavaScript). */
  private depthCheck(e: Extract<Expr, { e: 'call' }>): string[] {
    if (!this.depth || e.fn !== this.depth.fn) return [];
    const detail = leanStr(`depth check failed at line ${e.site?.span.line ?? '?'}: ${e.site?.text ?? e.fn}`);
    return [`Faithful.ck (decide (${this.depth.param} < ${MAX_RECURSION_DEPTH})) ${detail}`];
  }

  private callRef(e: Extract<Expr, { e: 'call' }>): string {
    return this.depth && e.fn === this.depth.fn ? `${this.callName(e.fn)} (${this.depth.param} + 1)` : this.callName(e.fn);
  }

  private effectfulCall(fn: string): boolean {
    return this.mode.kind === 'chk' || this.mode.throwing.has(fn);
  }

  effectful(e: Expr): boolean {
    let eff = false;
    walkExpr(e, (x) => {
      if (eff) return;
      if (x.e === 'throw') eff = true;
      else if (x.e === 'call' && this.effectfulCall(x.fn)) eff = true;
      else if (x.e === 'prim' && this.mode.kind === 'chk' && checkOf(x)) eff = true;
    });
    return eff;
  }

  /** Lines of a do-sequence computing `e` (in tail position) in the monad. */
  tail(e: Expr): string[] {
    switch (e.e) {
      case 'let': {
        const v = this.evalM(e.value);
        return [...v.lines, `let ${e.name} := ${this.P(v.res, 6)}`, ...this.tail(e.body)];
      }
      case 'letState': {
        const v = this.evalM(e.value);
        const bind = e.names.length === 0 ? [] : [`let ${pattern(e.names.map((n) => n.name))} := ${this.P(v.res, 6)}`];
        return [...v.lines, ...bind, ...this.tail(e.body)];
      }
      case 'if': {
        const v = this.evalM(e.cond);
        return [...v.lines, `if ${this.C(v.res, 6)} then`, ...indent(this.tail(e.then)), 'else', ...indent(this.tail(e.else))];
      }
      case 'matchFlow': {
        const v = this.evalM(e.scrut);
        return [
          ...v.lines,
          `match ${this.P(v.res, 6)} with`,
          `| .ret ${e.retVar.name} =>`,
          ...indent(this.tail(e.onRet)),
          `| .next ${pattern(e.nextNames.map((n) => n.name))} =>`,
          ...indent(this.tail(e.onNext)),
        ];
      }
      case 'matchList': {
        const v = this.evalM(e.scrut);
        return [
          ...v.lines,
          `match ${this.P(v.res, 6)} with`,
          '| [] =>',
          ...indent(this.tail(e.onNil)),
          `| ${e.head.name} :: ${e.tail.name} =>`,
          ...indent(this.tail(e.onCons)),
        ];
      }
      case 'throw':
        return [this.mode.kind === 'chk' ? `throw (Faithful.Fail.thrown ${leanStr(e.message)})` : `throw ${leanStr(e.message)}`];
      case 'call': {
        if (!this.effectfulCall(e.fn)) break;
        const v = this.evalArgs(e.args);
        return [...v.lines, ...this.depthCheck(e), `${this.callRef(e)}${v.res.map((a) => ' ' + this.P(a, 6)).join('')}`];
      }
      default:
        break;
    }
    const v = this.evalM(e);
    return [...v.lines, `pure ${this.P(v.res, 6)}`];
  }

  private evalArgs(args: Expr[]): { lines: string[]; res: Expr[] } {
    const lines: string[] = [];
    const res: Expr[] = [];
    for (const a of args) {
      const v = this.evalM(a);
      lines.push(...v.lines);
      res.push(v.res);
    }
    return { lines, res };
  }

  private bindDo(e: Expr): { lines: string[]; res: Expr } {
    const t = this.freshTmp();
    return { lines: [`let ${t} ← do`, ...indent(indent(this.tail(e)))], res: { e: 'var', ty: e.ty, name: t } };
  }

  /** Calls to effectful functions, or callbacks whose bodies have effects (these need binds). */
  private needsBind(e: Expr): boolean {
    let b = false;
    walkExpr(e, (x) => {
      if (b) return;
      if (x.e === 'throw') b = true;
      else if (x.e === 'call' && this.effectfulCall(x.fn)) b = true;
      else if (x.e === 'lam' && this.effectful(x.body)) b = true;
      else if (x.e === 'let' || x.e === 'letState' || x.e === 'matchFlow' || x.e === 'matchList') b = true;
    });
    return b;
  }

  /**
   * Check lines only, for an expression with no binds: the checks of its operations in JavaScript evaluation order,
   * short-circuit respected (`a && b` checks b only under `if a`). The value stays the pure expression itself, so
   * `if` conditions keep their hypotheses for termination proofs.
   */
  private checksOnly(e: Expr): string[] {
    if (!this.effectful(e)) return [];
    const guarded = (cond: string, lines: string[]): string[] => (lines.length ? [`if ${cond} then`, ...indent(lines)] : []);
    switch (e.e) {
      case 'prim': {
        if (e.op === 'and' || e.op === 'or') {
          const [a, b] = e.args as [Expr, Expr];
          const ca = this.C(a, 8);
          return [...this.checksOnly(a), ...guarded(e.op === 'and' ? ca : `¬ ${ca}`, this.checksOnly(b))];
        }
        const lines: string[] = [];
        for (const a of e.args) lines.push(...this.checksOnly(a));
        const chk = checkOf(e);
        if (chk && this.mode.kind === 'chk') lines.push(this.checkLine(e, chk.kind));
        return lines;
      }
      case 'if': {
        const c = this.C(e.cond, 8);
        const t = this.checksOnly(e.then);
        const f = this.checksOnly(e.else);
        return [...this.checksOnly(e.cond), ...guarded(c, t), ...guarded(`¬ ${c}`, f)];
      }
      default: {
        const lines: string[] = [];
        for (const ch of childrenForChecks(e)) lines.push(...this.checksOnly(ch));
        return lines;
      }
    }
  }

  private checkLine(node: Extract<Expr, { e: 'prim' }>, kind: string): string {
    const detail = leanStr(`${kind} check failed at line ${node.site?.span.line ?? '?'}: ${node.site?.text ?? node.op}`);
    const [x, y] = node.args;
    switch (kind) {
      case 'range':
        return `Faithful.ck (Faithful.inRange ${this.P(node, 8)}) ${detail}`;
      case 'nonzero':
        return `Faithful.ck (decide (${this.P(y!, 8)} ≠ 0)) ${detail}`;
      case 'bounds':
        return `Faithful.ck (Faithful.inBounds ${this.P(x!, 8)} ${this.P(y!, 8)}) ${detail}`;
      case 'length':
        return `Faithful.ck (decide ((${this.P(node, 8)}).length ≤ ${MAX_STRING_LENGTH})) ${detail}`;
      default:
        return `Faithful.ckAscii ${this.P(x!, 8)} ${detail}`;
    }
  }

  /** Evaluate `e` in JavaScript order: lines (checks, effectful calls) and a pure residual expression. */
  evalM(e: Expr): { lines: string[]; res: Expr } {
    if (!this.effectful(e)) return { lines: [], res: e };
    if (!this.needsBind(e)) return { lines: this.checksOnly(e), res: e };
    switch (e.e) {
      case 'prim': {
        if (e.op === 'and' || e.op === 'or') {
          const [a, b] = e.args as [Expr, Expr];
          if (!this.effectful(b)) {
            const va = this.evalM(a);
            return { lines: va.lines, res: { ...e, args: [va.res, b] } };
          }
          const asIf: Expr =
            e.op === 'and'
              ? { e: 'if', ty: e.ty, cond: a, then: b, else: { e: 'bool', ty: e.ty, value: false } }
              : { e: 'if', ty: e.ty, cond: a, then: { e: 'bool', ty: e.ty, value: true }, else: b };
          return this.bindDo(asIf);
        }
        const lines: string[] = [];
        const res: Expr[] = [];
        let lamEff = false;
        for (const a of e.args) {
          if (a.e === 'lam') {
            res.push(a);
            if (this.effectful(a.body)) lamEff = true;
            continue;
          }
          const v = this.evalM(a);
          lines.push(...v.lines);
          res.push(v.res);
        }
        if (lamEff) {
          // monadic combinator over the (already evaluated) receiver
          const t = this.freshTmp();
          const lam = res[1] as Extract<Expr, { e: 'lam' }>;
          const fn = `(fun ${lam.params.map((p) => `(${p.name} : ${leanTy(p.ty, this.c)})`).join(' ')} => do\n${indent(indent(indent(this.tail(lam.body)))).join('\n')})`;
          const xs = this.P(res[0]!, 6);
          let line: string;
          switch (e.op) {
            case 'map':
              line = `List.mapM ${fn} ${xs}`;
              break;
            case 'mapI':
              line = `Faithful.mapIM ${fn} ${xs}`;
              break;
            case 'filter':
              line = `List.filterM ${fn} ${xs}`;
              break;
            case 'filterI':
              line = `Faithful.filterIM ${fn} ${xs}`;
              break;
            case 'foldl':
              line = `List.foldlM ${fn} ${this.P(res[2]!, 6)} ${xs}`;
              break;
            case 'foldlI':
              line = `Faithful.foldlIM ${fn} ${this.P(res[2]!, 6)} ${xs}`;
              break;
            default:
              throw new Error(`internal: effectful callback in ${e.op}`);
          }
          lines.push(`let ${t} ← ${line}`);
          return { lines, res: { e: 'var', ty: e.ty, name: t } };
        }
        const node = { ...e, args: res };
        const chk = checkOf(e);
        if (chk && this.mode.kind === 'chk') lines.push(this.checkLine(node, chk.kind));
        return { lines, res: node };
      }
      case 'call': {
        const v = this.evalArgs(e.args);
        if (!this.effectfulCall(e.fn)) return { lines: v.lines, res: { ...e, args: v.res } };
        const t = this.freshTmp();
        return {
          lines: [...v.lines, ...this.depthCheck(e), `let ${t} ← ${this.callRef(e)}${v.res.map((a) => ' ' + this.P(a, 8)).join('')}`],
          res: { e: 'var', ty: e.ty, name: t },
        };
      }
      case 'tuple':
      case 'list':
      case 'state': {
        const v = this.evalArgs(e.elems);
        return { lines: v.lines, res: { ...e, elems: v.res } };
      }
      case 'record': {
        const v = this.evalArgs(e.fields.map((f) => f.value));
        return { lines: v.lines, res: { ...e, fields: e.fields.map((f, i) => ({ name: f.name, value: v.res[i]! })) } };
      }
      case 'proj': {
        const v = this.evalM(e.tuple);
        return { lines: v.lines, res: { ...e, tuple: v.res } };
      }
      case 'field': {
        const v = this.evalM(e.rec);
        return { lines: v.lines, res: { ...e, rec: v.res } };
      }
      case 'some':
      case 'flowRet':
      case 'flowNext': {
        const v = this.evalM(e.value);
        return { lines: v.lines, res: { ...e, value: v.res } };
      }
      default:
        return this.bindDo(e);
    }
  }
}

/** Children in evaluation order for the check-only walk (lambdas are excluded: their effects force a bind). */
function childrenForChecks(e: Expr): Expr[] {
  switch (e.e) {
    case 'tuple':
    case 'list':
    case 'state':
      return e.elems;
    case 'record':
      return e.fields.map((f) => f.value);
    case 'proj':
      return [e.tuple];
    case 'field':
      return [e.rec];
    case 'some':
    case 'flowRet':
    case 'flowNext':
      return [e.value];
    case 'call':
      return e.args;
    default:
      return [];
  }
}

function indent(lines: string[]): string[] {
  return lines.map((l) => '  ' + l.replace(/\n/g, '\n  '));
}

// ---------------------------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------------------------

function isRecursive(f: IrFunction): boolean {
  let rec = false;
  walkExpr(f.body, (e) => {
    if (e.e === 'call' && e.fn === f.name) rec = true;
  });
  return rec;
}

function terminationLines(f: IrFunction, m: Measure, p: Printer): string[] {
  let by: string;
  if (m.kind === 'int') by = `termination_by (${p.P(m.expr, 2)}).toNat`;
  else by = `termination_by ${m.param}.length`;
  const hints = (m.kind === 'list-length' ? [] : m.hints).map((h) =>
    h.kind === 'fdiv'
      ? `all_goals (try have := Faithful.fdiv_lt_self (a := ${h.param}) (k := ${h.k}) (by omega) (by decide))`
      : `all_goals (try have := Faithful.sliceFrom_length_lt ${h.param} (k := ${h.k}) (by omega) (by faithful_len_pos))`,
  );
  void f;
  // `faithful_unlet` first: the hints' side conditions (`by omega`, `faithful_len_pos`) need the unfolded guards too
  const unlet = m.kind !== 'list-length' && m.unlet ? ['faithful_unlet'] : [];
  return [by, `decreasing_by`, ...[...unlet, ...hints].map((h) => `  ${h}`), '  faithful_decreasing'];
}

function header(name: string, f: IrFunction, c: LeanCtx, ret: string): string {
  return `def ${name}${f.params.map((x) => ` (${x.name} : ${leanTy(x.ty, c)})`).join('')} : ${ret} :=`;
}

export interface EmittedLean {
  text: string;
  names: { original: string; rangeOk: string; pre: string; chk: string; asciiOk: string | null };
  paramTypes: string[];
  retType: string;
}

export interface PreconditionText {
  intBound: string | null;
  bmp: string | null;
}

export function emitProgram(p: IrProgram, opts: { usesAscii: boolean; pre: PreconditionText }): EmittedLean {
  const c: LeanCtx = { records: recordsMap(p.records) };
  const out: string[] = ['import Faithful.Core', '', 'set_option autoImplicit false', 'set_option linter.unusedVariables false', '', 'namespace Model', ''];
  for (const r of p.records) {
    out.push(`structure ${r.name} where`);
    for (const f of r.fields) out.push(`  ${f.lean} : ${leanTy(f.ty, c)}`);
    out.push('  deriving Repr, Inhabited', '');
    out.push(
      `instance : Lean.ToJson ${r.name} := ⟨fun r => Lean.Json.mkObj [${r.fields.map((f) => `(${leanStr(f.name)}, ${encoder(f.ty, c)} r.${f.lean})`).join(', ')}]⟩`,
      '',
    );
  }
  const throwing = new Set(p.functions.filter((f) => f.throws).map((f) => f.name));
  // the model
  for (const f of p.functions) {
    const rec = isRecursive(f);
    if (f.throws) {
      const pr = new MPrinter(c, (fn) => `Model.${fn}`, { kind: 'except', throwing });
      out.push(header(f.name, f, c, `Except String (${leanTy(f.ret, c)})`), '  do', ...indent(indent(pr.tail(f.body))));
      if (rec && f.measure) out.push(...terminationLines(f, f.measure, pr));
    } else {
      const pr = new Printer(c, (fn) => `Model.${fn}`);
      out.push(header(f.name, f, c, leanTy(f.ret, c)), `  ${pr.P(f.body, 2)}`);
      if (rec && f.measure) out.push(...terminationLines(f, f.measure, pr));
    }
    if (rec && !f.measure) throw new Error(`internal: recursive ${f.name} without a measure`);
    out.push('');
  }
  // the checked twin
  for (const f of p.functions) {
    const chkTy = `Faithful.Chk (${leanTy(f.ret, c)})`;
    if (f.role === 'main' && isRecursive(f)) {
      // Recursion depth (MAX_RECURSION_DEPTH, ir.ts): `<f>_chkD τd` is the twin at activation depth τd; `<f>_chk`
      // starts it at depth 1. Self-calls check `τd < D` after evaluating their arguments, then pass `τd + 1`.
      const D = 'τd';
      const pr = new MPrinter(c, (fn) => (fn === f.name ? `Model.${fn}_chkD` : `Model.${fn}_chk`), { kind: 'chk' }, { fn: f.name, param: D });
      out.push(`def ${f.name}_chkD (${D} : Nat)${f.params.map((x) => ` (${x.name} : ${leanTy(x.ty, c)})`).join('')} : ${chkTy} :=`, '  do', ...indent(indent(pr.tail(f.body))));
      if (f.measure) out.push(...terminationLines(f, f.measure, pr));
      out.push('');
      out.push(header(`${f.name}_chk`, f, c, chkTy), `  Model.${f.name}_chkD 1${f.params.map((x) => ` ${x.name}`).join('')}`, '');
      continue;
    }
    const pr = new MPrinter(c, (fn) => `Model.${fn}_chk`, { kind: 'chk' });
    out.push(header(`${f.name}_chk`, f, c, chkTy), '  do', ...indent(indent(pr.tail(f.body))));
    if (isRecursive(f) && f.measure) out.push(...terminationLines(f, f.measure, pr));
    out.push('');
  }
  const main = p.functions[p.functions.length - 1]!;
  const ps = main.params.map((x) => ` (${x.name} : ${leanTy(x.ty, c)})`).join('');
  const args = main.params.map((x) => ` ${x.name}`).join('');
  out.push(`def ${p.leanName}_rangeOk${ps} : Bool := Faithful.rangeOkOf (Model.${p.leanName}_chk${args})`, '');
  if (opts.usesAscii) out.push(`def ${p.leanName}_asciiOk${ps} : Bool := Faithful.asciiOkOf (Model.${p.leanName}_chk${args})`, '');
  const conj = [opts.pre.intBound, opts.pre.bmp, `Model.${p.leanName}_rangeOk${args}`, opts.usesAscii ? `Model.${p.leanName}_asciiOk${args}` : null].filter(
    (x): x is string => !!x,
  );
  out.push(`def ${p.leanName}_pre${ps} : Bool :=`, `  ${conj.map((x) => `(${x})`).join(' && ')}`, '');
  out.push('end Model', '');
  return {
    text: out.join('\n'),
    names: {
      original: `Model.${p.leanName}`,
      rangeOk: `Model.${p.leanName}_rangeOk`,
      pre: `Model.${p.leanName}_pre`,
      chk: `Model.${p.leanName}_chk`,
      asciiOk: opts.usesAscii ? `Model.${p.leanName}_asciiOk` : null,
    },
    paramTypes: main.params.map((x) => leanTy(x.ty, c)),
    retType: p.throws ? `Except String (${leanTy(main.ret, c)})` : leanTy(main.ret, c),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Precondition predicates (type-directed)
// ---------------------------------------------------------------------------------------------------------------

/** Lean Bool predicate "every int / every string in `x` satisfies `leaf`", or null when `t` has none. */
export function leanPred(t: Ty, x: string, k: 'int' | 'string', c: LeanCtx, depth = 0): string | null {
  switch (t.k) {
    case 'int':
      return k === 'int' ? `Faithful.intOk ${x}` : null;
    case 'string':
      return k === 'string' ? `Faithful.bmp ${x}` : null;
    case 'bool':
      return null;
    case 'array': {
      const v = `e${depth}`;
      const inner = leanPred(t.elem, v, k, c, depth + 1);
      return inner ? `(${x}).all (fun ${v} => ${inner})` : null;
    }
    case 'tuple': {
      const parts = t.elems.map((e, i) => leanPred(e, tupleProj(atomic(x), i, t.elems.length), k, c, depth)).filter((s): s is string => !!s);
      return parts.length ? parts.map((s) => `(${s})`).join(' && ') : null;
    }
    case 'record': {
      const r = c.records.get(recordKey(t))!;
      const parts = r.fields.map((f) => leanPred(f.ty, `${atomic(x)}.${f.lean}`, k, c, depth)).filter((s): s is string => !!s);
      return parts.length ? parts.map((s) => `(${s})`).join(' && ') : null;
    }
    case 'option':
      return null;
  }
}

/**
 * The same predicate in JavaScript, over the original parameter names.
 * Hygiene (red-team round 3, r3ParamMath / r3ParamNumber): the expression is evaluated with the parameters bound by
 * their TypeScript names (`compilePreconditions` in engine), so it must not read ANY global identifier: a parameter
 * named `Math`, `Number`, `globalThis`, ... would shadow it. It uses only operators (`typeof`, `%`, comparisons), a
 * regex literal, the `.every` method of the (array) argument itself, and the callback binders `e<depth>` (which only
 * shadow names inside their own callback, where nothing outer is read). `x % 1 === 0` holds exactly for finite
 * integers (NaN and +-Infinity give NaN), the same set as `Number.isInteger`.
 */
export function tsPred(t: Ty, x: string, k: 'int' | 'string', depth = 0): string | null {
  switch (t.k) {
    case 'int':
      return k === 'int' ? `(typeof ${x} === "number" && ${x} % 1 === 0 && ${x} >= -9007199254740992 && ${x} <= 9007199254740992)` : null;
    case 'string':
      return k === 'string' ? `(typeof ${x} === "string" && !/[\\uD800-\\uDFFF]/.test(${x}))` : null;
    case 'bool':
      return null;
    case 'array': {
      const v = `e${depth}`;
      const inner = tsPred(t.elem, v, k, depth + 1);
      return inner ? `${x}.every((${v}) => ${inner})` : null;
    }
    case 'tuple': {
      const parts = t.elems.map((e, i) => tsPred(e, `${x}[${i}]`, k, depth)).filter((s): s is string => !!s);
      return parts.length ? parts.join(' && ') : null;
    }
    case 'record': {
      const parts = t.fields.map((f) => tsPred(f.ty, `${x}[${JSON.stringify(f.name)}]`, k, depth)).filter((s): s is string => !!s);
      return parts.length ? parts.join(' && ') : null;
    }
    case 'option':
      return null;
  }
}

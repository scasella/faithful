/**
 * The encoder: the translator's IR (`translateWithIr(...).ir`) to SMT-LIB 2, by symbolic evaluation.
 *
 * Every expression evaluates to `R = { st, v }`:
 *   st  an Int status term: 0 = normal, 1 = fuel exhausted (unrolling bound U reached), 2 + m = `throw` of message m
 *       (a table shared by every encoder of one query), VIOL_BASE + c = the range check c failed (the checked twin's
 *       `range-ok` / `ascii` / depth conditions; `checks[c]` is the same detail text the instrumented original reports);
 *   v   the symbolic value, meaningful only when st = 0.
 * Statuses compose in JavaScript evaluation order: the first non-normal status wins (arguments left to right, then the
 * operation's own check; `&&`/`||` evaluate the right operand only when needed).
 *
 * Calls are inlined. A loop function (role `loop`) gets fuel U per loop entry, counted in ITERATIONS: U completed
 * iterations take U + 1 activations (the last is the exit test), so its (U+2)-th nested activation is "fuel
 * exhausted" (round 2, R2-L1: it was the (U+1)-th, which excluded loops of exactly U iterations). The main function's self-recursion likewise (its U+1-th nested activation), after the recursion-depth
 * check of the twin (`depth < MAX_RECURSION_DEPTH` before every self-call). `for...of` loops (measure `list-length`)
 * recurse on a tail whose capacity shrinks by one, so they are unrolled by capacity and never exhaust fuel.
 * Identical calls (same function, same depth, same argument terms) are encoded once. The memo rarely hits for
 * recursion on integer arguments: a range-checked `n - 1` becomes a fresh name `ite(ok, n - 1, 0)`, so `(n - 1) - 1`
 * and `n - 2` are different terms and doubly recursive functions are encoded in time and space exponential in U.
 * `fuelUsed` tells the equivalence query that some activation reached U (it then runs its coverage check).
 *
 * Constructs the encoder cannot encode exactly are listed by `unsupportedConstructs` BEFORE any encoding.
 */
import {
  MAX_RECURSION_DEPTH,
  checkOf,
  walkExpr,
  type Expr,
  type IrFunction,
  type IrProgram,
  type IrTy,
  type PrimOp,
} from '@faithful/translate';
import { cdiv, fdiv, iabs, inBounds, inRange, nonzero, tmod } from './intsem.js';
import {
  arrIncludes,
  arrIndexOf,
  asciiOk,
  boolToStr,
  caseMap,
  concat,
  intToStr,
  join,
  lengthOk,
  select,
  slice,
  split,
  strIndexOf,
  strLe,
  strLt,
  type Seq,
} from './seq.js';
import { FALSE, TRUE, Unsupported, add, and, b2i, eq, ge, gt, int, ite, le, lt, maxT, minT, mul, neg, not, or, sub, type Smt, type T } from './terms.js';
import { B, I, asBool, asInt, asSeq, defaultOf, merge, strLit, svEq, type SV } from './values.js';

export const ST_OK = '0';
export const ST_FUEL = '1';
export const THROW_BASE = 2;
export const VIOL_BASE = 1_000_000;

export interface Shared {
  /** Throw messages; status 2 + i is `throw msgs[i]`. Shared by the encoders of one query. */
  msgs: string[];
}

export interface EncodeOptions {
  /** Unrolling bound U (loop iterations per loop entry; nested activations of the recursive main function). */
  unroll: number;
  shared: Shared;
}

export interface R {
  st: T;
  v: SV;
}

const SUPPORTED_PRIMS: ReadonlySet<PrimOp> = new Set<PrimOp>([
  'add', 'sub', 'mul', 'neg', 'tmod', 'fdiv', 'cdiv', 'abs', 'min', 'max',
  'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'not',
  'strLen', 'strConcat', 'charAt', 'strAt', 'charCodeAt', 'strSlice', 'strSliceFrom', 'strIndexOf',
  'split', 'join', 'toLower', 'toUpper', 'intToStr', 'boolToStr',
  'len', 'at', 'slice', 'sliceFrom', 'concat', 'indexOf', 'includes',
  'map', 'mapI', 'filter', 'filterI', 'foldl', 'foldlI', 'sortBy',
]);

const CALLBACK_PRIMS: ReadonlySet<PrimOp> = new Set<PrimOp>(['map', 'mapI', 'filter', 'filterI', 'foldl', 'foldlI']);

/**
 * Constructs of `prog` the encoder cannot encode exactly (empty when the whole program is encodable). Checked
 * statically over every function body, so a construct behind a dead or fuel-exhausted branch is still reported.
 */
export function unsupportedConstructs(prog: IrProgram): string[] {
  const out = new Set<string>();
  for (const f of prog.functions) {
    const lamOk = new Set<Expr>();
    walkExpr(f.body, (x) => {
      if (x.e === 'prim') {
        if (!SUPPORTED_PRIMS.has(x.op)) out.add(`primitive ${x.op}`);
        if (x.op === 'sortBy') {
          if (!x.sort) out.add('sortBy without a recognized comparator');
          else lamOk.add(x.sort.key);
        }
        if (CALLBACK_PRIMS.has(x.op)) {
          const lam = x.args[1];
          if (!lam || lam.e !== 'lam') out.add(`${x.op} without an inline callback`);
          else lamOk.add(lam);
        }
        if ((x.op === 'min' || x.op === 'max') && x.args.length === 0) out.add(`Math.${x.op}() with no arguments`);
      } else if (x.e === 'lam' && !lamOk.has(x)) {
        out.add('a callback outside map/filter/reduce/sort');
      } else if (x.e === 'call' && !prog.functions.some((g) => g.name === x.fn)) {
        out.add(`call of an unknown function ${x.fn}`);
      }
    });
  }
  return [...out];
}

interface Ctx {
  fn: string;
  depth: number;
}

type Env = Map<string, SV>;

export class Encoder {
  /** Detail text of each check (status VIOL_BASE + index), exactly as the instrumented original reports it. */
  readonly checks: string[] = [];
  private readonly checkIds = new Map<object, number>();
  private readonly fns = new Map<string, IrFunction>();
  private readonly memo = new Map<string, R>();
  readonly main: IrFunction;
  /**
   * Set when some activation hit the unrolling bound (the encoding then contains a fuel-exhaustion status). Read by
   * `checkEquivalent`: when set, an `unsat` is reported only after the coverage check (equivalence.ts).
   */
  fuelUsed = false;

  constructor(
    readonly smt: Smt,
    readonly prog: IrProgram,
    readonly opts: EncodeOptions,
  ) {
    for (const f of prog.functions) this.fns.set(f.name, f);
    const main = prog.functions.find((f) => f.role === 'main' && f.name === prog.leanName) ?? prog.functions[prog.functions.length - 1];
    if (!main) throw new Error('internal: empty IR program');
    this.main = main;
    const bad = unsupportedConstructs(prog);
    if (bad.length) throw new Unsupported(bad.join(', '));
  }

  /** Evaluate the main function on symbolic arguments (top-level activation: depth 1). */
  run(args: SV[]): R {
    return this.inline(this.main, args, 1);
  }

  /** Status of a check: 0 when `ok`, else the check's violation code. */
  private check(node: object, kind: string, site: { span: { line: number }; text: string } | undefined, fallback: string, ok: T): T {
    if (ok === TRUE) return ST_OK;
    let id = this.checkIds.get(node);
    if (id === undefined) {
      id = this.checks.length;
      this.checks.push(`${kind} check failed at line ${site?.span.line ?? '?'}: ${site?.text ?? fallback}`);
      this.checkIds.set(node, id);
    }
    return ite(ok, ST_OK, String(VIOL_BASE + id));
  }

  /** Sequential composition of statuses: `a`, and `b` only when `a` is normal. */
  private then(a: T, b: () => T): T {
    if (a === ST_OK) return b();
    if (/^\d+$/.test(a)) return a; // a literal abnormal status: b never runs
    const bb = b();
    if (bb === ST_OK) return a;
    return this.smt.def('Int', ite(eq(a, ST_OK), bb, a));
  }

  private stDef(t: T): T {
    return this.smt.def('Int', t);
  }

  private inline(f: IrFunction, args: SV[], depth: number): R {
    // Fuel counts ITERATIONS for a loop function (red-team round 2, R2-L1): a loop that completes U iterations needs
    // U + 1 activations (the last one is the exit test), so activation U + 2 is the first fuel. For the recursive main
    // function an activation IS a nested call, so activation U + 1 is fuel ("U nested calls").
    const limit = f.role === 'loop' ? this.opts.unroll + 1 : this.opts.unroll;
    if (f.measure?.kind !== 'list-length' && depth > limit) {
      this.fuelUsed = true;
      return { st: ST_FUEL, v: defaultOf(f.ret) };
    }
    if (depth > 100_000) throw new Error(`internal: runaway unrolling of ${f.name}`);
    const key = `${f.name}|${depth}|${JSON.stringify(args)}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const env: Env = new Map();
    f.params.forEach((p, i) => env.set(p.name, args[i]!));
    const r = this.ev(f.body, env, { fn: f.name, depth });
    this.memo.set(key, r);
    return r;
  }

  /** Evaluate `es` left to right; the combined status and the values. */
  private evArgs(es: Expr[], env: Env, ctx: Ctx): { st: T; vs: SV[] } {
    let st: T = ST_OK;
    const vs: SV[] = [];
    for (const e of es) {
      if (st !== ST_OK && /^\d+$/.test(st)) {
        vs.push(defaultOf(e.ty));
        continue;
      }
      const r = this.ev(e, env, ctx);
      st = this.then(st, () => r.st);
      vs.push(r.v);
    }
    return { st, vs };
  }

  private bindNames(names: Array<{ name: string }>, v: SV, env: Env): Env {
    const out = new Map(env);
    if (names.length === 0) return out;
    if (names.length === 1) {
      out.set(names[0]!.name, v.k === 'tup' && v.el.length === 1 ? v.el[0]! : v);
      return out;
    }
    if (v.k !== 'tup' || v.el.length !== names.length) throw new Error(`internal: cannot destructure ${v.k} into ${names.length} names`);
    names.forEach((n, i) => out.set(n.name, v.el[i]!));
    return out;
  }

  ev(e: Expr, env: Env, ctx: Ctx): R {
    const smt = this.smt;
    switch (e.e) {
      case 'int':
        return { st: ST_OK, v: I(int(e.value)) };
      case 'bool':
        return { st: ST_OK, v: B(e.value ? TRUE : FALSE) };
      case 'str':
        return { st: ST_OK, v: strLit(e.value) };
      case 'var': {
        const v = env.get(e.name);
        if (!v) throw new Error(`internal: unbound ${e.name}`);
        return { st: ST_OK, v };
      }
      case 'let': {
        const a = this.ev(e.value, env, ctx);
        if (/^[1-9]\d*$/.test(a.st)) return { st: a.st, v: defaultOf(e.ty) };
        const env2 = new Map(env);
        env2.set(e.name, a.v);
        const b = this.ev(e.body, env2, ctx);
        return { st: this.then(a.st, () => b.st), v: b.v };
      }
      case 'letState': {
        const a = this.ev(e.value, env, ctx);
        if (/^[1-9]\d*$/.test(a.st)) return { st: a.st, v: defaultOf(e.ty) };
        const b = this.ev(e.body, this.bindNames(e.names, a.v, env), ctx);
        return { st: this.then(a.st, () => b.st), v: b.v };
      }
      case 'if': {
        const c = this.ev(e.cond, env, ctx);
        if (/^[1-9]\d*$/.test(c.st)) return { st: c.st, v: defaultOf(e.ty) };
        const ct = asBool(c.v);
        const cond = ct === TRUE || ct === FALSE ? ct : smt.def('Bool', ct);
        if (cond === TRUE) {
          const t = this.ev(e.then, env, ctx);
          return { st: this.then(c.st, () => t.st), v: t.v };
        }
        if (cond === FALSE) {
          const f = this.ev(e.else, env, ctx);
          return { st: this.then(c.st, () => f.st), v: f.v };
        }
        const t = this.ev(e.then, env, ctx);
        const f = this.ev(e.else, env, ctx);
        return { st: this.then(c.st, () => this.stDef(ite(cond, t.st, f.st))), v: merge(smt, cond, t.v, f.v) };
      }
      case 'throw': {
        let i = this.opts.shared.msgs.indexOf(e.message);
        if (i < 0) {
          i = this.opts.shared.msgs.length;
          this.opts.shared.msgs.push(e.message);
        }
        return { st: String(THROW_BASE + i), v: defaultOf(e.ty) };
      }
      case 'call': {
        const f = this.fns.get(e.fn);
        if (!f) throw new Unsupported(`call of an unknown function ${e.fn}`);
        const a = this.evArgs(e.args, env, ctx);
        const self = ctx.fn === e.fn;
        const depth = self ? ctx.depth + 1 : 1;
        let st = a.st;
        if (self && f.name === this.main.name) {
          // the twin's recursion-depth check: the calling activation has depth < D
          const chk = this.check(e, 'depth', e.site, e.fn, ctx.depth < MAX_RECURSION_DEPTH ? TRUE : FALSE);
          st = this.then(st, () => chk);
        }
        if (/^[1-9]\d*$/.test(st)) return { st, v: defaultOf(e.ty) };
        const r = this.inline(f, a.vs, depth);
        return { st: this.then(st, () => r.st), v: r.v };
      }
      case 'state':
      case 'tuple': {
        const a = this.evArgs(e.elems, env, ctx);
        return { st: a.st, v: { k: 'tup', el: a.vs } };
      }
      case 'proj': {
        const a = this.ev(e.tuple, env, ctx);
        if (a.v.k !== 'tup') throw new Error('internal: proj of a non-tuple');
        return { st: a.st, v: a.v.el[e.index]! };
      }
      case 'record': {
        const a = this.evArgs(e.fields.map((f) => f.value), env, ctx);
        const f: Record<string, SV> = {};
        e.fields.forEach((x, i) => (f[x.name] = a.vs[i]!));
        return { st: a.st, v: { k: 'rec', f } };
      }
      case 'field': {
        const a = this.ev(e.rec, env, ctx);
        if (a.v.k !== 'rec') throw new Error('internal: field of a non-record');
        const v = a.v.f[e.name];
        if (!v) throw new Error(`internal: no field ${e.name}`);
        return { st: a.st, v };
      }
      case 'list': {
        const a = this.evArgs(e.elems, env, ctx);
        return { st: a.st, v: { k: 'seq', len: String(e.elems.length), el: a.vs } };
      }
      case 'some': {
        const a = this.ev(e.value, env, ctx);
        return { st: a.st, v: { k: 'opt', some: TRUE, v: a.v } };
      }
      case 'none':
        return { st: ST_OK, v: { k: 'opt', some: FALSE } };
      case 'flowRet': {
        const a = this.ev(e.value, env, ctx);
        return { st: a.st, v: { k: 'flow', isRet: TRUE, ret: a.v } };
      }
      case 'flowNext': {
        const a = this.ev(e.value, env, ctx);
        return { st: a.st, v: { k: 'flow', isRet: FALSE, next: a.v } };
      }
      case 'matchFlow': {
        const s = this.ev(e.scrut, env, ctx);
        if (/^[1-9]\d*$/.test(s.st)) return { st: s.st, v: defaultOf(e.ty) };
        if (s.v.k !== 'flow') throw new Error('internal: matchFlow on a non-flow');
        const fl = s.v;
        const isRet = fl.isRet;
        const onRet = (): R => {
          const env2 = new Map(env);
          env2.set(e.retVar.name, fl.ret ?? defaultOf(e.retVar.ty));
          return this.ev(e.onRet, env2, ctx);
        };
        const onNext = (): R => this.ev(e.onNext, this.bindNames(e.nextNames, fl.next ?? defaultOf(nextTy(e.scrut.ty)), env), ctx);
        if (isRet === TRUE || !fl.next) {
          const r = onRet();
          return { st: this.then(s.st, () => r.st), v: r.v };
        }
        if (isRet === FALSE || !fl.ret) {
          const r = onNext();
          return { st: this.then(s.st, () => r.st), v: r.v };
        }
        const a = onRet();
        const b = onNext();
        return { st: this.then(s.st, () => this.stDef(ite(isRet, a.st, b.st))), v: merge(smt, isRet, a.v, b.v) };
      }
      case 'matchList': {
        const s = this.ev(e.scrut, env, ctx);
        if (/^[1-9]\d*$/.test(s.st)) return { st: s.st, v: defaultOf(e.ty) };
        const xs = asSeq(s.v);
        const onNil = (): R => this.ev(e.onNil, env, ctx);
        if (xs.el.length === 0) {
          const r = onNil();
          return { st: this.then(s.st, () => r.st), v: r.v };
        }
        const isNil = smt.def('Bool', eq(xs.len, '0'));
        const tail: SV = { k: 'seq', len: smt.def('Int', sub(xs.len, '1')), el: xs.el.slice(1) };
        if (xs.sum !== undefined) (tail as Seq).sum = xs.sum;
        const env2 = new Map(env);
        env2.set(e.head.name, xs.el[0]!);
        env2.set(e.tail.name, tail);
        const cons = this.ev(e.onCons, env2, ctx);
        if (isNil === FALSE) return { st: this.then(s.st, () => cons.st), v: cons.v };
        const nil = onNil();
        if (isNil === TRUE) return { st: this.then(s.st, () => nil.st), v: nil.v };
        return { st: this.then(s.st, () => this.stDef(ite(isNil, nil.st, cons.st))), v: merge(smt, isNil, nil.v, cons.v) };
      }
      case 'lam':
        throw new Unsupported('a callback outside map/filter/reduce/sort');
      case 'prim':
        return this.prim(e, env, ctx);
    }
  }

  private applyLam(lam: Expr, args: SV[], env: Env, ctx: Ctx): R {
    if (lam.e !== 'lam') throw new Unsupported('a callback that is not an inline function');
    const env2 = new Map(env);
    lam.params.forEach((p, i) => {
      if (i < args.length) env2.set(p.name, args[i]!);
    });
    return this.ev(lam.body, env2, ctx);
  }

  private prim(e: Extract<Expr, { e: 'prim' }>, env: Env, ctx: Ctx): R {
    const smt = this.smt;
    const op = e.op;
    // short-circuit booleans
    if (op === 'and' || op === 'or') {
      const a = this.ev(e.args[0]!, env, ctx);
      if (/^[1-9]\d*$/.test(a.st)) return { st: a.st, v: B(FALSE) };
      const av = asBool(a.v);
      const needB = op === 'and' ? av : not(av);
      if (needB === FALSE) return { st: a.st, v: B(av) };
      const b = this.ev(e.args[1]!, env, ctx);
      const bv = asBool(b.v);
      const st = this.then(a.st, () => this.stDef(ite(needB, b.st, ST_OK)));
      return { st, v: B(smt.def('Bool', op === 'and' ? and(av, bv) : or(av, bv))) };
    }
    const nonLam = e.args.filter((x) => x.e !== 'lam');
    const a = this.evArgs(nonLam, env, ctx);
    if (/^[1-9]\d*$/.test(a.st)) return { st: a.st, v: defaultOf(e.ty) };
    const [x, y, z] = a.vs;
    const chk = checkOf(e);
    const withCheck = (v: SV, ok: T): R => ({
      st: this.then(a.st, () => (chk ? this.check(e, chk.kind, e.site, e.op, ok) : ST_OK)),
      v,
    });
    const iv = (t: T): SV => I(smt.def('Int', t));
    const bv = (t: T): SV => B(smt.def('Bool', t));
    switch (op) {
      case 'add':
      case 'sub':
      case 'mul': {
        const p = asInt(x!);
        const q = asInt(y!);
        const r = smt.def('Int', op === 'add' ? add(p, q) : op === 'sub' ? sub(p, q) : mul(p, q));
        const ok = inRange(r);
        // Out of range the check fails and the value is never observed; passing 0 on keeps later (unobserved)
        // values small: otherwise repeated squaring after a violation builds numbers with millions of digits.
        const v = ok === TRUE ? r : smt.def('Int', ite(ok, r, '0'));
        return withCheck(I(v), ok);
      }
      case 'neg':
        return withCheck(iv(neg(asInt(x!))), TRUE);
      case 'tmod':
        return withCheck(iv(tmod(asInt(x!), asInt(y!))), nonzero(asInt(y!)));
      case 'fdiv':
        return withCheck(iv(fdiv(asInt(x!), asInt(y!))), nonzero(asInt(y!)));
      case 'cdiv':
        return withCheck(iv(cdiv(asInt(x!), asInt(y!))), nonzero(asInt(y!)));
      case 'abs':
        return withCheck(iv(iabs(asInt(x!))), TRUE);
      case 'min':
      case 'max': {
        let r = asInt(a.vs[0]!);
        for (const w of a.vs.slice(1)) r = smt.def('Int', op === 'min' ? minT(r, asInt(w)) : maxT(r, asInt(w)));
        return withCheck(I(r), TRUE);
      }
      case 'eq':
      case 'ne': {
        const t = svEq(x!, y!);
        return withCheck(bv(op === 'eq' ? t : not(t)), TRUE);
      }
      case 'lt':
      case 'le':
      case 'gt':
      case 'ge': {
        if (x!.k === 'seq') {
          const p = asSeq(x!);
          const q = asSeq(y!);
          const t = op === 'lt' ? strLt(smt, p, q) : op === 'le' ? strLe(smt, p, q) : op === 'gt' ? strLt(smt, q, p) : strLe(smt, q, p);
          return withCheck(B(t), TRUE);
        }
        const p = asInt(x!);
        const q = asInt(y!);
        return withCheck(bv(op === 'lt' ? lt(p, q) : op === 'le' ? le(p, q) : op === 'gt' ? gt(p, q) : ge(p, q)), TRUE);
      }
      case 'not':
        return withCheck(B(not(asBool(x!))), TRUE);
      case 'strLen':
      case 'len':
        return withCheck(I(asSeq(x!).len), TRUE);
      case 'strConcat':
      case 'concat': {
        const r = concat(smt, asSeq(x!), asSeq(y!));
        return withCheck(r, op === 'strConcat' ? lengthOk(r) : TRUE);
      }
      case 'charAt': {
        const s = asSeq(x!);
        const i = asInt(y!);
        const len = smt.def('Int', b2i(inBounds(i, s.len)));
        return withCheck({ k: 'seq', len, el: s.el.length ? [select(smt, s, i, I('0'))] : [] }, TRUE);
      }
      case 'strAt': {
        const s = asSeq(x!);
        const i = asInt(y!);
        return withCheck({ k: 'seq', len: '1', el: [select(smt, s, i, I('0'))] }, inBounds(i, s.len));
      }
      case 'charCodeAt': {
        const s = asSeq(x!);
        const i = asInt(y!);
        return withCheck(select(smt, s, i, I('0')), inBounds(i, s.len));
      }
      case 'strSlice':
      case 'slice':
        return withCheck(slice(smt, asSeq(x!), asInt(y!), asInt(z!)), TRUE);
      case 'strSliceFrom':
      case 'sliceFrom':
        return withCheck(slice(smt, asSeq(x!), asInt(y!), undefined), TRUE);
      case 'strIndexOf':
        return withCheck(I(strIndexOf(smt, asSeq(x!), asSeq(y!), z ? asInt(z) : '0')), TRUE);
      case 'split':
        return withCheck(split(smt, asSeq(x!), asSeq(y!)), TRUE);
      case 'join': {
        const r = join(smt, asSeq(x!), y ? asSeq(y) : (strLit(',') as Seq));
        return withCheck(r, lengthOk(r));
      }
      case 'toLower':
      case 'toUpper': {
        const s = asSeq(x!);
        return withCheck(caseMap(smt, s, op === 'toLower'), asciiOk(s));
      }
      case 'intToStr':
        return withCheck(intToStr(smt, asInt(x!)), TRUE);
      case 'boolToStr':
        return withCheck(boolToStr(smt, asBool(x!)), TRUE);
      case 'at': {
        const s = asSeq(x!);
        const i = asInt(y!);
        return withCheck(select(smt, s, i, defaultOf(elemTy(e.args[0]!.ty))), inBounds(i, s.len));
      }
      case 'indexOf':
        return withCheck(I(arrIndexOf(smt, asSeq(x!), y!)), TRUE);
      case 'includes':
        return withCheck(B(arrIncludes(smt, asSeq(x!), y!)), TRUE);
      case 'map':
      case 'mapI':
      case 'filter':
      case 'filterI':
      case 'foldl':
      case 'foldlI':
        return this.callback(e, a.st, a.vs, env, ctx);
      case 'sortBy':
        return withCheck(this.sortBy(e, asSeq(x!), env, ctx), TRUE);
    }
  }

  /** map / filter / reduce: the callback inlined once per slot; slot j counts only when j < length. */
  private callback(e: Extract<Expr, { e: 'prim' }>, st0: T, vs: SV[], env: Env, ctx: Ctx): R {
    const smt = this.smt;
    const lam = e.args[1]!;
    const xs = asSeq(vs[0]!);
    const n = xs.el.length;
    let st = st0;
    const guard = (j: number): T => lt(String(j), xs.len);
    const step = (j: number, r: R): void => {
      const g = guard(j);
      st = this.then(st, () => (r.st === ST_OK ? ST_OK : this.stDef(ite(g, r.st, ST_OK))));
    };
    switch (e.op) {
      case 'map':
      case 'mapI': {
        const el: SV[] = [];
        for (let j = 0; j < n; j++) {
          const r = this.applyLam(lam, [xs.el[j]!, I(String(j))], env, ctx);
          step(j, r);
          el.push(r.v);
        }
        return { st, v: { k: 'seq', len: xs.len, el } };
      }
      case 'filter':
      case 'filterI': {
        const keep: T[] = [];
        for (let j = 0; j < n; j++) {
          const r = this.applyLam(lam, [xs.el[j]!, I(String(j))], env, ctx);
          step(j, r);
          keep.push(smt.def('Bool', and(guard(j), asBool(r.v))));
        }
        // compaction: slot m of the result is the j-th element with keep[j] and m kept elements before it
        const before: T[] = [];
        let c: T = '0';
        for (let j = 0; j < n; j++) {
          before.push(c);
          c = smt.def('Int', add(c, b2i(keep[j]!)));
        }
        const el: SV[] = [];
        for (let m = 0; m < n; m++) {
          let r: SV = xs.el[n - 1]!;
          for (let j = n - 1; j >= m; j--) r = merge(smt, and(keep[j]!, eq(before[j]!, String(m))), xs.el[j]!, r);
          el.push(r);
        }
        const out: Seq = { k: 'seq', len: c, el };
        if (xs.sum !== undefined) out.sum = xs.sum;
        return { st, v: out };
      }
      default: {
        // foldl / foldlI: reduce((acc, x[, i]) => f, init)
        let acc = vs[1]!;
        for (let j = 0; j < n; j++) {
          const r = this.applyLam(lam, [acc, xs.el[j]!, I(String(j))], env, ctx);
          step(j, r);
          acc = merge(smt, guard(j), r.v, acc);
        }
        return { st, v: acc };
      }
    }
  }

  /** Stable sort by key: a bubble network that swaps neighbours only when strictly out of order (= List.mergeSort's result). */
  private sortBy(e: Extract<Expr, { e: 'prim' }>, xs: Seq, env: Env, ctx: Ctx): Seq {
    const smt = this.smt;
    const spec = e.sort!;
    const key = (v: SV): SV => {
      const r = this.applyLam(spec.key, [v], env, ctx);
      if (r.st !== ST_OK) throw new Unsupported('a sort key that can fail');
      return r.v;
    };
    const less = (p: SV, q: SV): T => (spec.keyTy === 'int' ? lt(asInt(p), asInt(q)) : strLt(smt, asSeq(p), asSeq(q)));
    const el = [...xs.el];
    const n = el.length;
    for (let pass = 0; pass < n - 1; pass++) {
      for (let j = 0; j < n - 1 - pass; j++) {
        const ka = key(el[j]!);
        const kb = key(el[j + 1]!);
        const out = spec.descending ? less(ka, kb) : less(kb, ka);
        const sw = smt.def('Bool', and(lt(String(j + 1), xs.len), out));
        const a = el[j]!;
        const b = el[j + 1]!;
        el[j] = merge(smt, sw, b, a);
        el[j + 1] = merge(smt, sw, a, b);
      }
    }
    const out: Seq = { k: 'seq', len: xs.len, el };
    if (xs.sum !== undefined) out.sum = xs.sum;
    return out;
  }
}

function elemTy(t: IrTy): IrTy {
  if (t.k === 'array') return t.elem;
  if (t.k === 'string') return { k: 'string' };
  throw new Error(`internal: element type of ${t.k}`);
}

function nextTy(t: IrTy): IrTy {
  if (t.k === 'flow') return t.next;
  throw new Error('internal: flow type');
}


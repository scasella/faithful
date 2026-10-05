/**
 * TypeScript -> IR lowering.
 *
 * Statements are lowered in continuation-passing style: `stmts(list, i, env, ctx)` produces the IR of "run statement i,
 * then the rest", where `ctx` says what falling off the end, `return`, `break` and `continue` mean at that point.
 *  - Reassignment becomes a fresh `let` (SSA); `env` maps each TypeScript variable symbol to its current IR name.
 *  - An `if` statement without jumps (return/throw/break/continue) joins: both branches produce the tuple of the
 *    variables they modify (`letState`). An `if` with jumps duplicates the continuation into each branch
 *    (bounded by MAX_IR_NODES).
 *  - Each loop becomes an IR function `<fn>_loop<k>` whose parameters are the variables the loop reads but never
 *    assigns ("captured", passed unchanged) followed by the variables it assigns ("loop-carried"). It returns the
 *    loop-carried state, or a `Flow` when the body can `return`. `continue` = recursive call (after the incrementor),
 *    `break` = return the current state, `return v` = `Flow.ret v`.
 *  - A termination measure is required for every loop and for self-recursion; see `findLoopMeasure` and
 *    `findRecursionMeasure` for the recognized patterns. Anything else is refused with `no-termination-measure`.
 */
import ts from 'typescript';
import type { ThrowSite, Ty } from './contracts.js';
import {
  BOOL, INT, checkOf, STR, children as directChildren, tyEq, walkExpr,
  type Expr, type IrFunction, type IrParam, type IrProgram, type IrTy, type Measure, type MeasureHint, type PrimOp, type Site, type SortSpec,
} from './ir.js';
import { Names, Records, findLineDirectiveFor, leanIdent, mapType, refuse, spanOf } from './types.js';
import { hasSurrogate, isGlobal } from './scan.js';

const K = ts.SyntaxKind;
export const MAX_IR_NODES = 40_000;
const TWO53 = 9007199254740992n;

interface VarBind {
  name: string;
  ty: Ty;
}
type Env = Map<ts.Symbol, VarBind>;

interface Ctx {
  fall: (env: Env) => Expr;
  ret: (env: Env, v: Expr) => Expr;
  brk: ((env: Env) => Expr) | null;
  cont: ((env: Env) => Expr) | null;
  /** Type of a returned value in this context. */
  retTy: Ty;
  /** Wrap returned values in some/none (main function with an option return type). */
  optionRet: boolean;
  /** Type of the tail of the IR function being built. */
  tailTy: IrTy;
  names: Names;
  cb: { outer: Set<ts.Symbol> } | null;
  inLoop: boolean;
}

interface LoopInfo {
  name: string;
  captured: ts.Symbol[];
  loopVars: ts.Symbol[];
  hasRet: boolean;
  ty: IrTy;
  retTy: Ty;
}

export interface LowerResult {
  program: IrProgram;
  throwSites: ThrowSite[];
  notes: string[];
  usesAscii: boolean;
  /** Module-level `const NAME = literal` statements the function reads (inlined in the model). */
  moduleConsts: ts.VariableStatement[];
  /** Comparator callbacks recognized as sort keys (left uninstrumented). */
  comparators: Set<ts.Node>;
  /** Nodes to route through a runtime check, with the `FAITHFUL_TS_RUNTIME` helper name (see `collectChecked`). */
  checked: Map<ts.Node, string>;
  /** The main function calls itself (its checked twin carries a recursion depth). */
  recursive: boolean;
}

function unparen(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

const mkInt = (v: bigint): Expr => ({ e: 'int', ty: INT, value: v });
const mkBool = (v: boolean): Expr => ({ e: 'bool', ty: BOOL, value: v });
const mkStr = (v: string): Expr => ({ e: 'str', ty: STR, value: v });
const mkVar = (b: VarBind | IrParam): Expr => ({ e: 'var', ty: b.ty, name: b.name });
const prim = (op: PrimOp, ty: IrTy, args: Expr[], site?: Site): Expr => (site ? { e: 'prim', ty, op, args, site } : { e: 'prim', ty, op, args });
const stateTy = (tys: IrTy[]): IrTy => ({ k: 'state', elems: tys });

function isFunctionLike(n: ts.Node): boolean {
  return ts.isFunctionLike(n) || ts.isClassLike(n);
}
function isLoop(n: ts.Node): boolean {
  return ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n);
}

export class Lowerer {
  private readonly records: Records;
  private readonly functions: IrFunction[] = [];
  private readonly loopMemo = new Map<ts.Node, LoopInfo>();
  private loopCount = 0;
  private readonly throwSites = new Map<number, ThrowSite>();
  private readonly notes = new Set<string>();
  private usesAscii = false;
  private readonly mutable: Set<ts.Symbol>;
  private readonly moduleConsts = new Map<ts.Symbol, { stmt: ts.VariableStatement; value: Expr }>();
  private readonly selfCallNodes = new Map<Expr, ts.Node>();
  private readonly comparators = new Set<ts.Node>();
  private readonly siteNodes = new Map<Site, ts.Node>();
  private irNodes = 0;
  readonly leanName: string;
  private mainRet!: Ty;
  private mainParams: IrParam[] = [];

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly sf: ts.SourceFile,
    private readonly fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    private readonly fnSymbol: ts.Symbol | undefined,
    readonly fnName: string,
    records: Records,
    /** Error diagnostics (syntactic and semantic) of the whole file, for the module constants the function reads. */
    private readonly fileDiags: readonly ts.Diagnostic[] = [],
  ) {
    this.records = records;
    this.leanName = leanIdent(fnName);
    this.mutable = this.collectAssigned(fnNode);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Entry
  // ------------------------------------------------------------------------------------------------------------

  /** Lower the function. `params`/`ret` were already mapped by the signature check. */
  lower(params: Array<{ sym: ts.Symbol; name: string; ty: Ty }>, ret: Ty): LowerResult {
    this.mainRet = ret;
    const names = new Names();
    const env: Env = new Map();
    this.mainParams = params.map((p) => {
      const name = names.fresh(p.name);
      env.set(p.sym, { name, ty: p.ty });
      return { name, ty: p.ty };
    });
    const optionRet = ret.k === 'option';
    const ctx: Ctx = {
      fall: () => {
        if (optionRet) return { e: 'none', ty: ret };
        refuse('unsupported-syntax', 'control can reach the end of the function without returning a value', this.fnNode);
      },
      ret: (_env, v) => v,
      brk: null,
      cont: null,
      retTy: ret,
      optionRet,
      tailTy: ret,
      names,
      cb: null,
      inLoop: false,
    };
    const body = this.fnNode.body;
    let ir: Expr;
    if (!body) refuse('unsupported-syntax', 'the function has no body', this.fnNode);
    if (ts.isBlock(body)) ir = this.stmts(body.statements, 0, env, ctx);
    else ir = this.retValue(body, env, ctx);
    const measure = this.findRecursionMeasure(ir);
    const main: IrFunction = { name: this.leanName, role: 'main', params: this.mainParams, ret, throws: false, body: ir, measure };
    this.functions.push(main);
    this.computeThrows();
    if (measure) this.notes.add(`termination (recursion): ${measure.pattern}`);
    return {
      program: {
        fnName: this.fnName,
        leanName: this.leanName,
        params: this.mainParams,
        ret,
        throws: main.throws,
        records: this.records.all(),
        functions: this.functions,
      },
      throwSites: [...this.throwSites.values()].sort((a, b) => a.span.start - b.span.start),
      notes: [...this.notes],
      usesAscii: this.usesAscii,
      moduleConsts: [...new Set([...this.moduleConsts.values()].map((m) => m.stmt))].sort((a, b) => a.pos - b.pos),
      comparators: this.comparators,
      checked: this.collectChecked(),
      recursive: measure !== null,
    };
  }

  private computeThrows(): void {
    const byName = new Map(this.functions.map((f) => [f.name, f]));
    const direct = (f: IrFunction): { throws: boolean; calls: string[] } => {
      let throws = false;
      const calls: string[] = [];
      walkExpr(f.body, (e) => {
        if (e.e === 'throw') throws = true;
        if (e.e === 'call') calls.push(e.fn);
      });
      return { throws, calls };
    };
    const info = new Map(this.functions.map((f) => [f.name, direct(f)]));
    for (const f of this.functions) f.throws = info.get(f.name)!.throws;
    for (let changed = true; changed; ) {
      changed = false;
      for (const f of this.functions) {
        if (f.throws) continue;
        if (info.get(f.name)!.calls.some((c) => byName.get(c)?.throws)) {
          f.throws = true;
          changed = true;
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Symbols and types
  // ------------------------------------------------------------------------------------------------------------

  private symOf(id: ts.Identifier): ts.Symbol | undefined {
    if (id.parent && ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id)
      return this.checker.getShorthandAssignmentValueSymbol(id.parent);
    return this.checker.getSymbolAtLocation(id);
  }

  /**
   * `id` names the builtin global (every declaration of its symbol is in the lib files). Red-team round 2,
   * moduleMathShadow: the old test `!sym || !this.isLocal(sym)` also accepted a module-level `const Math = ...`, so
   * `Math.floor(a / b)` on the user's object was modeled as Int.fdiv. When this is false the name is lowered as an
   * ordinary identifier (`ident`), which refuses module-level state precisely.
   */
  private isLibGlobal(id: ts.Identifier): boolean {
    return isGlobal(this.checker, id, this.sf);
  }

  private isLocal(sym: ts.Symbol): boolean {
    const d = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!d || d.getSourceFile() !== this.sf) return false;
    return d.pos >= this.fnNode.pos && d.end <= this.fnNode.end;
  }

  private declPos(sym: ts.Symbol): number {
    const d = sym.valueDeclaration ?? sym.declarations?.[0];
    return d ? d.getStart(this.sf) : 0;
  }

  private tyOfType(t: ts.Type, at: ts.Node, what: string): Ty {
    return mapType(this.checker, t, at, this.records, { allowOption: false, what });
  }

  private tyAt(node: ts.Node, what = 'this expression'): Ty {
    return this.tyOfType(this.checker.getTypeAtLocation(node), node, what);
  }

  private tryTy(t: ts.Type, at: ts.Node): Ty | null {
    try {
      return this.tyOfType(t, at, 'value');
    } catch {
      return null;
    }
  }

  /** Type of an array/object literal: its contextual type when that is a subset type, else its own type. */
  private literalTy(node: ts.Expression, want: 'array' | 'record'): Ty {
    const c = this.checker.getContextualType(node);
    if (c) {
      const m = this.tryTy(this.checker.getNonNullableType(c), node);
      if (m && (want === 'record' ? m.k === 'record' : m.k === 'array' || m.k === 'tuple')) return m;
    }
    return this.tyAt(node);
  }

  private site(node: ts.Node): Site {
    const text = node.getText(this.sf).replace(/\s+/g, ' ');
    const s: Site = { span: spanOf(node, this.sf), text: text.length > 60 ? `${text.slice(0, 57)}...` : text };
    this.siteNodes.set(s, node);
    return s;
  }

  /**
   * The TypeScript nodes the instrumentation must route through a runtime check, read off the final IR (the IR the
   * checked twin is printed from): every primitive in `CHECKED_OPS` -> its node and helper name, and every self-call
   * -> `rec` (the recursion-depth check). This is the single oracle for "which operations are checked"; instrument.ts
   * makes no type-based decisions of its own (red-team round 1: literal-union operands escaped a NumberLike test).
   */
  private collectChecked(): Map<ts.Node, string> {
    const out = new Map<ts.Node, string>();
    for (const f of this.functions) {
      walkExpr(f.body, (e) => {
        const c = checkOf(e);
        if (e.e === 'prim' && c) {
          const node = e.site ? this.siteNodes.get(e.site) : undefined;
          if (!node) throw new Error(`internal: checked operation ${e.op} without a source node`);
          {
            const prev = out.get(node);
            if (prev !== undefined && prev !== c.ts) throw new Error(`internal: node checked as both ${prev} and ${c.ts}`);
            out.set(node, c.ts);
          }
        }
        if (e.e === 'call' && e.fn === this.leanName) {
          const node = this.selfCallNodes.get(e);
          if (!node) throw new Error('internal: self-call without a source node');
          out.set(node, 'rec');
        }
      });
    }
    return out;
  }

  private count(e: Expr): Expr {
    this.irNodes++;
    if (this.irNodes > MAX_IR_NODES)
      refuse('unsupported-syntax', `control flow too complex to translate (more than ${MAX_IR_NODES} IR nodes after duplicating continuations)`, this.fnNode);
    return e;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Syntactic analyses
  // ------------------------------------------------------------------------------------------------------------

  /** Symbols assigned (=, op=, ++, --) anywhere inside `node`. */
  private collectAssigned(node: ts.Node): Set<ts.Symbol> {
    const out = new Set<ts.Symbol>();
    const visit = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= K.FirstAssignment && n.operatorToken.kind <= K.LastAssignment) {
        const l = unparen(n.left);
        if (ts.isIdentifier(l)) {
          const s = this.symOf(l);
          if (s) out.add(s);
        }
      }
      if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken)) {
        const o = unparen(n.operand);
        if (ts.isIdentifier(o)) {
          const s = this.symOf(o);
          if (s) out.add(s);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
  }

  /** Local symbols referenced inside `nodes`. */
  private collectReferenced(nodes: ts.Node[]): Set<ts.Symbol> {
    const out = new Set<ts.Symbol>();
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const namePos =
          (p && ts.isPropertyAccessExpression(p) && p.name === n) ||
          (p && ts.isPropertyAssignment(p) && p.name === n) ||
          (p && (ts.isVariableDeclaration(p) || ts.isParameter(p)) && p.name === n);
        if (!namePos) {
          const s = this.symOf(n);
          if (s && this.isLocal(s)) out.add(s);
        }
      }
      ts.forEachChild(n, visit);
    };
    for (const n of nodes) visit(n);
    return out;
  }

  /** Symbols declared (variables, callback parameters) inside `nodes`. */
  private collectDeclared(nodes: ts.Node[]): Set<ts.Symbol> {
    const out = new Set<ts.Symbol>();
    const visit = (n: ts.Node): void => {
      if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name)) {
        const s = this.checker.getSymbolAtLocation(n.name);
        if (s) out.add(s);
      }
      ts.forEachChild(n, visit);
    };
    for (const n of nodes) visit(n);
    return out;
  }

  /** `return` inside `node` (not inside nested functions). */
  private containsReturn(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
      if (found || isFunctionLike(n)) return;
      if (ts.isReturnStatement(n)) found = true;
      else ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  /** return/throw anywhere, or break/continue that leaves `node` (not inside a nested loop). */
  private containsJump(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node, loopDepth: number): void => {
      if (found || isFunctionLike(n)) return;
      if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) found = true;
      else if (ts.isBreakOrContinueStatement(n) && loopDepth === 0) found = true;
      else ts.forEachChild(n, (c) => visit(c, loopDepth + (isLoop(n) ? 1 : 0)));
    };
    visit(node, 0);
    return found;
  }

  /** `continue` belonging to the loop whose body is `body`. */
  private hasOwnContinue(body: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
      if (found || isFunctionLike(n) || isLoop(n)) return;
      if (ts.isContinueStatement(n)) found = true;
      else ts.forEachChild(n, visit);
    };
    visit(body);
    return found;
  }

  private containsSelfCall(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && this.isSelf(n.expression)) found = true;
      else ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  private isSelf(id: ts.Identifier): boolean {
    const s = this.symOf(id);
    return !!s && !!this.fnSymbol && s === this.fnSymbol;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Statements
  // ------------------------------------------------------------------------------------------------------------

  private stmts(list: readonly ts.Statement[], i: number, env: Env, ctx: Ctx): Expr {
    if (i >= list.length) return ctx.fall(env);
    const s = list[i]!;
    const rest = (env2: Env): Expr => this.stmts(list, i + 1, env2, ctx);
    switch (s.kind) {
      case K.VariableStatement: {
        const dl = (s as ts.VariableStatement).declarationList;
        if (!(dl.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) || dl.flags & ts.NodeFlags.Using)
          refuse('unsupported-syntax', '`var` declarations are outside subset v1; use let or const', s);
        return this.decls(dl.declarations, 0, env, ctx, rest);
      }
      case K.ExpressionStatement:
        return this.assignExpr((s as ts.ExpressionStatement).expression, env, ctx, rest);
      case K.ReturnStatement: {
        const v = this.retValue((s as ts.ReturnStatement).expression, env, ctx, s);
        return ctx.ret(env, v);
      }
      case K.ThrowStatement:
        return this.throwStmt(s as ts.ThrowStatement, ctx);
      case K.IfStatement:
        return this.ifStmt(s as ts.IfStatement, env, ctx, rest);
      case K.Block:
        return this.stmts((s as ts.Block).statements, 0, env, { ...ctx, fall: rest });
      case K.ForStatement:
      case K.ForOfStatement:
      case K.WhileStatement:
        return this.loop(s as ts.ForStatement | ts.ForOfStatement | ts.WhileStatement, env, ctx, rest);
      case K.BreakStatement: {
        const b = s as ts.BreakStatement;
        if (b.label) refuse('unsupported-syntax', 'labeled break is outside subset v1', s);
        if (!ctx.brk) refuse('unsupported-syntax', '`break` outside a loop', s);
        return ctx.brk(env);
      }
      case K.ContinueStatement: {
        const c = s as ts.ContinueStatement;
        if (c.label) refuse('unsupported-syntax', 'labeled continue is outside subset v1', s);
        if (!ctx.cont) refuse('unsupported-syntax', '`continue` outside a loop', s);
        return ctx.cont(env);
      }
      case K.EmptyStatement:
        return rest(env);
      case K.DoStatement:
        refuse('unsupported-syntax', 'do...while loops are outside subset v1; use while', s);
      case K.ForInStatement:
        refuse('unsupported-syntax', 'for...in loops are outside subset v1', s);
      case K.SwitchStatement:
        refuse('unsupported-syntax', 'switch statements are outside subset v1; use if/else', s);
      case K.TryStatement:
        refuse('unsupported-syntax', 'try/catch is outside subset v1', s);
      case K.LabeledStatement:
        refuse('unsupported-syntax', 'labels are outside subset v1', s);
      case K.FunctionDeclaration:
        refuse('unsupported-syntax', 'nested function declarations are outside subset v1', s);
      case K.ClassDeclaration:
        refuse('unsupported-syntax', 'classes are outside subset v1', s);
      default:
        refuse('unsupported-syntax', `${ts.SyntaxKind[s.kind]} statements are outside subset v1`, s);
    }
  }

  private decls(ds: readonly ts.VariableDeclaration[], j: number, env: Env, ctx: Ctx, k: (env: Env) => Expr): Expr {
    if (j >= ds.length) return k(env);
    const d = ds[j]!;
    if (!ts.isIdentifier(d.name)) refuse('unsupported-syntax', 'destructuring declarations are outside subset v1', d.name);
    if (!d.initializer) refuse('unsupported-syntax', 'declare variables with an initializer', d);
    const init = unparen(d.initializer);
    if (!d.type && ts.isArrayLiteralExpression(init) && init.elements.length === 0)
      refuse('missing-annotation', `annotate the type of \`${d.name.text}\` (TypeScript cannot infer the element type of an empty array)`, d);
    const sym = this.checker.getSymbolAtLocation(d.name);
    if (!sym) refuse('unsupported-syntax', 'internal: unresolved declaration', d);
    const ty = this.tyOfType(this.checker.getTypeOfSymbolAtLocation(sym, d.name), d.type ?? d.name, `variable \`${d.name.text}\``);
    const value = this.expr(d.initializer, env, ctx);
    if (!tyEq(value.ty, ty)) refuse('unsupported-type', `variable \`${d.name.text}\` is initialized with a value of a different type`, d);
    const name = ctx.names.fresh(d.name.text);
    const env2 = new Map(env).set(sym, { name, ty });
    return this.count({ e: 'let', ty: ctx.tailTy, name, value, body: this.decls(ds, j + 1, env2, ctx, k) });
  }

  private checkAssignable(sym: ts.Symbol, at: ts.Node, env: Env, ctx: Ctx): VarBind {
    const cur = env.get(sym);
    if (!cur) {
      if (!this.isLocal(sym)) refuse('mutable-capture', 'assignment to a variable outside the function (module-level mutable state)', at);
      refuse('unsupported-syntax', 'assignment to a variable that is not in scope here', at);
    }
    if (ctx.cb && ctx.cb.outer.has(sym)) refuse('mutable-capture', 'a callback assigns a variable of the enclosing function (closure over mutable state)', at);
    // JS throws TypeError on assignment to a `const` (red-team round 4, r4TsIgnoreConstAssign; TS2588 can be hidden).
    const decl = sym.valueDeclaration;
    if (decl && ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent) && decl.parent.flags & ts.NodeFlags.Const)
      refuse('unsupported-syntax', 'assignment to a `const` variable (JavaScript throws TypeError)', at);
    return cur;
  }

  /** Lower an expression statement (assignments only), then continue with `k`. */
  private assignExpr(node: ts.Expression, env: Env, ctx: Ctx, k: (env: Env) => Expr): Expr {
    const e = ts.isParenthesizedExpression(node) ? unparen(node) : node;
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === K.CommaToken) return this.assignExpr(e.left, env, ctx, (env2) => this.assignExpr(e.right, env2, ctx, k));
      if (op >= K.FirstAssignment && op <= K.LastAssignment) {
        const l = unparen(e.left);
        if (!ts.isIdentifier(l))
          refuse('unsupported-syntax', 'assignment to an array element or record field: arrays and records are immutable in subset v1', e.left);
        const sym = this.symOf(l);
        if (!sym) refuse('unsupported-syntax', 'internal: unresolved assignment target', l);
        const cur = this.checkAssignable(sym, l, env, ctx);
        let value: Expr;
        const site = this.site(e);
        if (op === K.EqualsToken) value = this.expr(e.right, env, ctx);
        else {
          const rhs = this.expr(e.right, env, ctx);
          const lhs = mkVar(cur);
          switch (op) {
            case K.PlusEqualsToken:
              value = this.plus(lhs, rhs, site, e);
              break;
            case K.MinusEqualsToken:
              value = this.arith('sub', lhs, rhs, site, e);
              break;
            case K.AsteriskEqualsToken:
              value = this.arith('mul', lhs, rhs, site, e);
              break;
            case K.PercentEqualsToken:
              value = this.arith('tmod', lhs, rhs, site, e);
              this.notes.add('JS % is truncated (sign of the dividend): modeled as Int.tmod, never Lean %');
              break;
            default:
              refuse('unsupported-syntax', `the assignment operator \`${e.operatorToken.getText(this.sf)}\` is outside subset v1`, e.operatorToken);
          }
        }
        if (!tyEq(value.ty, cur.ty)) refuse('unsupported-type', `assignment changes the type of \`${l.text}\``, e);
        const name = ctx.names.fresh(l.text);
        const env2 = new Map(env).set(sym, { name, ty: cur.ty });
        return this.count({ e: 'let', ty: ctx.tailTy, name, value, body: k(env2) });
      }
    }
    if ((ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) && (e.operator === K.PlusPlusToken || e.operator === K.MinusMinusToken)) {
      const o = unparen(e.operand);
      if (!ts.isIdentifier(o)) refuse('unsupported-syntax', 'increment of an array element or field: arrays and records are immutable in subset v1', e);
      const sym = this.symOf(o);
      if (!sym) refuse('unsupported-syntax', 'internal: unresolved increment target', o);
      const cur = this.checkAssignable(sym, o, env, ctx);
      if (cur.ty.k !== 'int') refuse('unsupported-syntax', '++/-- on a non-number', e);
      const value = prim(e.operator === K.PlusPlusToken ? 'add' : 'sub', INT, [mkVar(cur), mkInt(1n)], this.site(e));
      const name = ctx.names.fresh(o.text);
      const env2 = new Map(env).set(sym, { name, ty: cur.ty });
      return this.count({ e: 'let', ty: ctx.tailTy, name, value, body: k(env2) });
    }
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const m = e.expression.name.text;
      if (['push', 'pop', 'shift', 'unshift', 'splice', 'reverse', 'fill', 'copyWithin', 'sort'].includes(m))
        refuse('unsupported-library', `Array.prototype.${m} mutates the array; arrays are immutable in subset v1 (build a new array with concat/slice/map/filter)`, e);
    }
    refuse('unsupported-syntax', 'this statement has no effect in a pure function (only assignments, declarations and control flow are statements in subset v1)', node);
  }

  private retValue(node: ts.Expression | undefined, env: Env, ctx: Ctx, stmt?: ts.Node): Expr {
    if (!ctx.optionRet) {
      if (!node) refuse('unsupported-syntax', '`return` without a value', stmt ?? this.fnNode);
      const v = this.expr(node, env, ctx);
      if (!tyEq(v.ty, ctx.retTy)) refuse('unsupported-type', 'the returned value does not have the declared return type', node);
      return v;
    }
    const opt = ctx.retTy as Extract<Ty, { k: 'option' }>;
    if (!node) return { e: 'none', ty: opt };
    const n = unparen(node);
    if (n.kind === K.NullKeyword || (ts.isIdentifier(n) && n.text === 'undefined' && this.isLibGlobal(n))) return { e: 'none', ty: opt };
    if (ts.isVoidExpression(n)) refuse('unsupported-syntax', '`void` is outside subset v1', n);
    if (ts.isConditionalExpression(n)) {
      const c = this.cond(n.condition, env, ctx);
      return { e: 'if', ty: opt, cond: c, then: this.retValue(n.whenTrue, env, ctx), else: this.retValue(n.whenFalse, env, ctx) };
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && this.isSelf(n.expression)) return this.selfCall(n, env, ctx);
    const v = this.expr(n, env, ctx);
    if (!tyEq(v.ty, opt.inner)) refuse('unsupported-type', 'the returned value does not have the declared return type', n);
    return { e: 'some', ty: opt, value: v };
  }

  private throwStmt(s: ts.ThrowStatement, ctx: Ctx): Expr {
    if (ctx.cb) refuse('unsupported-syntax', '`throw` inside a callback is outside subset v1', s);
    const ex = unparen(s.expression);
    let msg: string | undefined;
    if (ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex)) msg = ex.text;
    else if ((ts.isNewExpression(ex) || ts.isCallExpression(ex)) && ts.isIdentifier(ex.expression) && ex.expression.text === 'Error' && this.isLibGlobal(ex.expression)) {
      const a = ex.arguments ?? [];
      const a0 = a[0] ? unparen(a[0]) : undefined;
      if (a.length === 1 && a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) msg = a0.text;
    }
    if (msg === undefined)
      refuse('unsupported-syntax', 'only `throw new Error("literal message")` or `throw "literal message"` is supported', s);
    const span = spanOf(s, this.sf);
    this.throwSites.set(span.start, { message: msg, span });
    this.notes.add('throw is modeled as Except String (the message is the literal)');
    return { e: 'throw', ty: ctx.tailTy, message: msg };
  }

  private ifStmt(s: ts.IfStatement, env: Env, ctx: Ctx, rest: (env: Env) => Expr): Expr {
    const cond = this.cond(s.expression, env, ctx);
    if (this.containsJump(s)) {
      const thenE = this.stmts([s.thenStatement], 0, env, { ...ctx, fall: rest });
      const elseE = s.elseStatement ? this.stmts([s.elseStatement], 0, env, { ...ctx, fall: rest }) : rest(env);
      return this.count({ e: 'if', ty: ctx.tailTy, cond, then: thenE, else: elseE });
    }
    const modified = [...this.collectAssigned(s)].filter((sym) => env.has(sym)).sort((a, b) => this.declPos(a) - this.declPos(b));
    const sTy = stateTy(modified.map((m) => env.get(m)!.ty));
    const internal = (): never => refuse('unsupported-syntax', 'internal: jump in a join branch', s);
    const bctx: Ctx = {
      ...ctx,
      fall: (env2) => ({ e: 'state', ty: sTy, elems: modified.map((m) => mkVar(env2.get(m)!)) }),
      ret: internal,
      brk: null,
      cont: null,
      tailTy: sTy,
    };
    const thenE = this.stmts([s.thenStatement], 0, env, bctx);
    const elseE = s.elseStatement ? this.stmts([s.elseStatement], 0, env, bctx) : bctx.fall(env);
    const names: IrParam[] = modified.map((m) => ({ name: ctx.names.fresh(m.getName()), ty: env.get(m)!.ty }));
    const env2 = new Map(env);
    modified.forEach((m, i) => env2.set(m, names[i]! as VarBind));
    return this.count({ e: 'letState', ty: ctx.tailTy, names, value: { e: 'if', ty: sTy, cond, then: thenE, else: elseE }, body: rest(env2) });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Loops
  // ------------------------------------------------------------------------------------------------------------

  private loop(s: ts.ForStatement | ts.ForOfStatement | ts.WhileStatement, env: Env, ctx: Ctx, after: (env: Env) => Expr): Expr {
    if (ts.isForStatement(s) && s.initializer) {
      const init = s.initializer;
      if (ts.isVariableDeclarationList(init)) {
        if (!(init.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) refuse('unsupported-syntax', '`var` declarations are outside subset v1; use let', init);
        return this.decls(init.declarations, 0, env, ctx, (env1) => this.loopProper(s, env1, ctx, after));
      }
      return this.assignExpr(init, env, ctx, (env1) => this.loopProper(s, env1, ctx, after));
    }
    return this.loopProper(s, env, ctx, after);
  }

  private loopProper(s: ts.ForStatement | ts.ForOfStatement | ts.WhileStatement, env: Env, ctx: Ctx, after: (env: Env) => Expr): Expr {
    let iterable: Expr | undefined;
    if (ts.isForOfStatement(s)) {
      if (s.awaitModifier) refuse('async', '`for await` is outside subset v1', s);
      iterable = this.expr(s.expression, env, ctx);
      if (iterable.ty.k !== 'array')
        refuse('unsupported-syntax', iterable.ty.k === 'string' ? 'for...of over a string iterates code points; it is outside subset v1 (index the string instead)' : 'for...of over a non-array', s.expression);
    }
    const info = this.loopInfo(s, env, ctx, iterable?.ty);
    const args: Expr[] = info.captured.map((sym) => mkVar(env.get(sym)!));
    let pre: ((body: Expr) => Expr) | undefined;
    if (iterable) {
      const n = ctx.names.fresh('xs');
      const it = iterable;
      pre = (body) => ({ e: 'let', ty: ctx.tailTy, name: n, value: it, body });
      args.push({ e: 'var', ty: it.ty, name: n });
    }
    args.push(...info.loopVars.map((sym) => mkVar(env.get(sym)!)));
    const call: Expr = { e: 'call', ty: info.ty, fn: info.name, args };
    const nextNames: IrParam[] = info.loopVars.map((sym) => ({ name: ctx.names.fresh(sym.getName()), ty: env.get(sym)!.ty }));
    const env2 = new Map(env);
    info.loopVars.forEach((sym, i) => env2.set(sym, nextNames[i]! as VarBind));
    let out: Expr;
    if (info.hasRet) {
      const retVar: IrParam = { name: ctx.names.fresh('r'), ty: info.retTy };
      out = { e: 'matchFlow', ty: ctx.tailTy, scrut: call, retVar, onRet: ctx.ret(env, mkVar(retVar)), nextNames, onNext: after(env2) };
    } else {
      out = { e: 'letState', ty: ctx.tailTy, names: nextNames, value: call, body: after(env2) };
    }
    return this.count(pre ? pre(out) : out);
  }

  private loopInfo(s: ts.ForStatement | ts.ForOfStatement | ts.WhileStatement, envOuter: Env, ctx: Ctx, iterTy: IrTy | undefined): LoopInfo {
    const memo = this.loopMemo.get(s);
    if (memo) return memo;
    const parts: ts.Node[] = ts.isForStatement(s)
      ? [s.condition, s.incrementor, s.statement].filter((x): x is NonNullable<typeof x> => !!x)
      : ts.isForOfStatement(s)
        ? [s.initializer, s.statement]
        : [s.expression, s.statement];
    const declaredInside = this.collectDeclared(parts);
    const assigned = new Set<ts.Symbol>();
    for (const p of parts) for (const a of this.collectAssigned(p)) assigned.add(a);
    const byPos = (a: ts.Symbol, b: ts.Symbol): number => this.declPos(a) - this.declPos(b);
    const loopVars = [...assigned].filter((sym) => envOuter.has(sym) && !declaredInside.has(sym)).sort(byPos);
    for (const v of loopVars) if (ctx.cb && ctx.cb.outer.has(v)) refuse('mutable-capture', 'a loop inside a callback assigns a variable of the enclosing function', s);
    const captured = [...this.collectReferenced(parts)].filter((sym) => envOuter.has(sym) && !assigned.has(sym) && !declaredInside.has(sym)).sort(byPos);
    const hasRet = this.containsReturn(s.statement);
    const name = `${this.leanName}_loop${++this.loopCount}`;
    const names = new Names();
    const envL: Env = new Map();
    const params: IrParam[] = [];
    for (const sym of captured) {
      const b = { name: names.fresh(sym.getName()), ty: envOuter.get(sym)!.ty };
      envL.set(sym, b);
      params.push(b);
    }
    let restParam: IrParam | undefined;
    if (iterTy) {
      restParam = { name: names.fresh('rest'), ty: iterTy };
      params.push(restParam);
    }
    for (const sym of loopVars) {
      const b = { name: names.fresh(sym.getName()), ty: envOuter.get(sym)!.ty };
      envL.set(sym, b);
      params.push(b);
    }
    const sTy = stateTy(loopVars.map((sym) => envOuter.get(sym)!.ty));
    const ty: IrTy = hasRet ? { k: 'flow', ret: ctx.retTy, next: sTy } : sTy;
    const info: LoopInfo = { name, captured, loopVars, hasRet, ty, retTy: ctx.retTy };
    this.loopMemo.set(s, info);

    const measure = this.findLoopMeasure(s, loopVars, envL, restParam, { ...ctx, names, tailTy: ty, inLoop: true });
    this.notes.add(`termination (loop ${name}): ${measure.pattern}`);

    const stateOf = (env: Env): Expr => ({ e: 'state', ty: sTy, elems: loopVars.map((sym) => mkVar(env.get(sym)!)) });
    const exit = (env: Env): Expr => (hasRet ? { e: 'flowNext', ty, value: stateOf(env) } : stateOf(env));
    const selfCall = (env: Env, rest?: Expr): Expr => ({
      e: 'call',
      ty,
      fn: name,
      args: [...captured.map((sym) => mkVar(envL.get(sym)!)), ...(rest ? [rest] : []), ...loopVars.map((sym) => mkVar(env.get(sym)!))],
    });
    const lctx: Ctx = {
      ...ctx,
      names,
      tailTy: ty,
      inLoop: true,
      ret: hasRet ? (_env, v) => ({ e: 'flowRet', ty, value: v }) : () => refuse('unsupported-syntax', 'internal: return in a loop without returns', s),
      brk: exit,
      fall: exit,
      cont: exit,
    };
    let body: Expr;
    if (ts.isForOfStatement(s)) {
      const init = s.initializer;
      if (!ts.isVariableDeclarationList(init) || init.declarations.length !== 1)
        refuse('unsupported-syntax', 'for...of must declare its loop variable (for (const x of xs))', init);
      if (!(init.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) refuse('unsupported-syntax', '`var` declarations are outside subset v1', init);
      const d = init.declarations[0]!;
      if (!ts.isIdentifier(d.name)) refuse('unsupported-syntax', 'destructuring in for...of is outside subset v1', d.name);
      const sym = this.checker.getSymbolAtLocation(d.name)!;
      const elemTy = (iterTy as Extract<Ty, { k: 'array' }>).elem;
      const head: IrParam = { name: names.fresh(d.name.text), ty: elemTy };
      const tail: IrParam = { name: names.fresh('rest'), ty: iterTy! };
      const envB = new Map(envL).set(sym, head as VarBind);
      const next = (env: Env): Expr => selfCall(env, mkVar(tail));
      const onCons = this.stmts([s.statement], 0, envB, { ...lctx, fall: next, cont: next });
      body = { e: 'matchList', ty, scrut: mkVar(restParam!), onNil: exit(envL), head, tail, onCons };
    } else {
      const condNode = ts.isForStatement(s) ? s.condition : s.expression;
      if (!condNode) refuse('no-termination-measure', 'a loop without a condition has no termination measure', s);
      const cond = this.cond(condNode, envL, lctx);
      const incr = ts.isForStatement(s) ? s.incrementor : undefined;
      const step = (env: Env): Expr => (incr ? this.assignExpr(incr, env, lctx, (env2) => selfCall(env2)) : selfCall(env));
      const inner = this.stmts([s.statement], 0, envL, { ...lctx, fall: step, cont: step });
      body = { e: 'if', ty, cond, then: inner, else: exit(envL) };
    }
    this.functions.push({ name, role: 'loop', params, ret: ty, throws: false, body, measure });
    return info;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Termination measures
  // ------------------------------------------------------------------------------------------------------------

  /**
   * Recognized loop measures (first matching conjunct of the condition wins):
   *  1. for...of: structural recursion on the remaining elements.
   *  2. Counting: a conjunct `v < E`, `v <= E` (up) or `v > E`, `v >= E` (down) (either operand order), where `v` is a
   *     loop-carried number and `E` reads no loop-carried or loop-local variable; `v` is updated in exactly one place:
   *       (a) only by the for-incrementor, as v++ / ++v / v += k / v = v + k (up) or the mirror image (down), k >= 1
   *           a literal; or
   *       (b) by exactly one top-level statement of the loop body of that form, with no `continue` in the body.
   *     Measure: (E - v).toNat (+1 for <=) resp. (v - E).toNat (+1 for >=).
   *  3. Halving: a conjunct `v > c` (c >= 0 literal) or `v >= c` (c >= 1), with `v = Math.floor(v / k)` (k >= 2) as in
   *     2(a) or 2(b). Measure (v - c).toNat (+1 for >=).
   *  4. Shrinking: a conjunct `xs.length > 0` (or >= 1, !== 0, != 0, either operand order) with `xs = xs.slice(k)`
   *     (k >= 1) as in 2(a) or 2(b). Measure xs.length.
   */
  private findLoopMeasure(s: ts.ForStatement | ts.ForOfStatement | ts.WhileStatement, loopVars: ts.Symbol[], envL: Env, restParam: IrParam | undefined, ctx: Ctx): Measure {
    if (ts.isForOfStatement(s)) return { kind: 'list-length', param: restParam!.name, pattern: 'for...of: structural recursion over the remaining elements' };
    const condNode = ts.isForStatement(s) ? s.condition : s.expression;
    if (!condNode) refuse('no-termination-measure', 'a loop without a condition has no termination measure', s);
    const declaredInside = this.collectDeclared([s.statement]);
    const loopSet = new Set(loopVars);
    const conjuncts: ts.Expression[] = [];
    const split = (e: ts.Expression): void => {
      const u = unparen(e);
      if (ts.isBinaryExpression(u) && u.operatorToken.kind === K.AmpersandAmpersandToken) {
        split(u.left);
        split(u.right);
      } else conjuncts.push(u);
    };
    split(condNode);
    const invariant = (e: ts.Expression): boolean => {
      for (const sym of this.collectReferenced([e])) if (loopSet.has(sym) || declaredInside.has(sym)) return false;
      return !this.containsSelfCall(e) && this.collectAssigned(e).size === 0;
    };
    const loopVarOf = (e: ts.Expression): ts.Symbol | undefined => {
      const u = unparen(e);
      if (!ts.isIdentifier(u)) return undefined;
      const sym = this.symOf(u);
      return sym && loopSet.has(sym) ? sym : undefined;
    };
    const litOf = (e: ts.Expression): bigint | undefined => {
      const u = unparen(e);
      if (ts.isNumericLiteral(u)) return BigInt(Number(u.text));
      if (ts.isPrefixUnaryExpression(u) && u.operator === K.MinusToken && ts.isNumericLiteral(unparen(u.operand)))
        return -BigInt(Number((unparen(u.operand) as ts.NumericLiteral).text));
      return undefined;
    };
    const updateOf = (sym: ts.Symbol): { kind: 'add' | 'fdiv' | 'slice'; dir: 'up' | 'down'; k: bigint } | 'none' | 'bad' => {
      const sites: ts.Node[] = [];
      const visit = (n: ts.Node): void => {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind >= K.FirstAssignment && n.operatorToken.kind <= K.LastAssignment) {
          const l = unparen(n.left);
          if (ts.isIdentifier(l) && this.symOf(l) === sym) sites.push(n);
        }
        if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken)) {
          const o = unparen(n.operand);
          if (ts.isIdentifier(o) && this.symOf(o) === sym) sites.push(n);
        }
        ts.forEachChild(n, visit);
      };
      const incr = ts.isForStatement(s) ? s.incrementor : undefined;
      if (incr) visit(incr);
      const inIncr = sites.length;
      visit(s.statement);
      const inBody = sites.length - inIncr;
      if (sites.length !== 1) return sites.length === 0 ? 'none' : 'bad';
      const site = sites[0]!;
      if (inBody === 1) {
        // must be a top-level statement of the body, and the body has no `continue` of its own
        const stmt = site.parent;
        const top = ts.isBlock(s.statement) ? s.statement.statements : [s.statement];
        if (!stmt || !ts.isExpressionStatement(stmt) || !top.includes(stmt) || unparen(stmt.expression) !== site) return 'bad';
        if (this.hasOwnContinue(s.statement)) return 'bad';
      }
      return this.stepOf(site, sym) ?? 'bad';
    };

    for (const c of conjuncts) {
      if (!ts.isBinaryExpression(c)) continue;
      const op = c.operatorToken.kind;
      // shrinking array/string
      const lenOf = (e: ts.Expression): ts.Symbol | undefined => {
        const u = unparen(e);
        if (ts.isPropertyAccessExpression(u) && u.name.text === 'length') return loopVarOf(u.expression);
        return undefined;
      };
      {
        let arr: ts.Symbol | undefined;
        let lit: bigint | undefined;
        let rel: ts.SyntaxKind | undefined;
        if ((arr = lenOf(c.left)) && (lit = litOf(c.right)) !== undefined) rel = op;
        else if ((arr = lenOf(c.right)) && (lit = litOf(c.left)) !== undefined) rel = flip(op);
        if (arr && rel !== undefined && lit !== undefined) {
          const nonEmpty =
            (rel === K.GreaterThanToken && lit >= 0n) ||
            (rel === K.GreaterThanEqualsToken && lit >= 1n) ||
            ((rel === K.ExclamationEqualsEqualsToken || rel === K.ExclamationEqualsToken) && lit === 0n);
          const u = updateOf(arr);
          if (nonEmpty && typeof u === 'object' && u.kind === 'slice') {
            const p = envL.get(arr)!.name;
            return { kind: 'length', param: p, pattern: `shrinking: \`${arr.getName()}.length > 0\` with \`${arr.getName()} = ${arr.getName()}.slice(${u.k})\``, hints: [{ kind: 'slice', param: p, k: u.k }] };
          }
        }
      }
      // shrinking string: `s !== ""` (or `!=`, either operand order), the string form of `s.length !== 0`
      // (red-team round 1, whileNonEmptyStr)
      if (op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken) {
        const isEmptyLit = (e: ts.Expression): boolean => {
          const u = unparen(e);
          return (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) && u.text === '';
        };
        const sv = isEmptyLit(c.right) ? loopVarOf(c.left) : isEmptyLit(c.left) ? loopVarOf(c.right) : undefined;
        if (sv && envL.get(sv)!.ty.k === 'string') {
          const u = updateOf(sv);
          if (typeof u === 'object' && u.kind === 'slice') {
            const p = envL.get(sv)!.name;
            return { kind: 'length', param: p, pattern: `shrinking: \`${sv.getName()} !== ""\` with \`${sv.getName()} = ${sv.getName()}.slice(${u.k})\``, hints: [{ kind: 'slice', param: p, k: u.k }] };
          }
        }
      }
      if (![K.LessThanToken, K.LessThanEqualsToken, K.GreaterThanToken, K.GreaterThanEqualsToken].includes(op)) continue;
      let v: ts.Symbol | undefined;
      let bound: ts.Expression;
      let rel: ts.SyntaxKind;
      if ((v = loopVarOf(c.left)) && invariant(c.right)) {
        bound = c.right;
        rel = op;
      } else if ((v = loopVarOf(c.right)) && invariant(c.left)) {
        bound = c.left;
        rel = flip(op);
      } else continue;
      const vb = envL.get(v)!;
      if (vb.ty.k !== 'int') continue;
      const up = rel === K.LessThanToken || rel === K.LessThanEqualsToken;
      const strict = rel === K.LessThanToken || rel === K.GreaterThanToken;
      const u = updateOf(v);
      if (typeof u !== 'object') continue;
      const name = v.getName();
      if (u.kind === 'add' && u.dir === (up ? 'up' : 'down')) {
        const E = this.expr(bound, envL, ctx);
        if (E.ty.k !== 'int') continue;
        const V = mkVar(vb);
        const diff = up ? prim('sub', INT, [E, V]) : prim('sub', INT, [V, E]);
        const expr = strict ? diff : prim('add', INT, [diff, mkInt(1n)]);
        const how = ts.isForStatement(s) && s.incrementor && this.collectAssigned(s.incrementor).has(v) ? 'the incrementor' : 'one top-level statement of the body';
        return { kind: 'int', expr, hints: [], pattern: `counting ${up ? 'up' : 'down'}: \`${c.getText(this.sf)}\` with \`${name}\` ${up ? 'increased' : 'decreased'} by ${u.k} in ${how}` };
      }
      if (u.kind === 'fdiv' && !up) {
        const lit = litOf(bound);
        if (lit === undefined || (strict ? lit < 0n : lit < 1n)) continue;
        const V = mkVar(vb);
        const diff = prim('sub', INT, [V, mkInt(lit)]);
        return {
          kind: 'int',
          expr: strict ? diff : prim('add', INT, [diff, mkInt(1n)]),
          hints: [{ kind: 'fdiv', param: vb.name, k: u.k }],
          pattern: `halving: \`${c.getText(this.sf)}\` with \`${name} = Math.floor(${name} / ${u.k})\``,
        };
      }
    }
    refuse(
      'no-termination-measure',
      'no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) ' +
        'in the incrementor or in one top-level statement of the body without `continue`; `n > c` with n = Math.floor(n / k); ' +
        '`xs.length > 0` with xs = xs.slice(k). E must not change inside the loop',
      condNode,
    );
  }

  /** Recognize one update of `sym`: v++ / v += k / v = v + k / v = k + v (up), mirror (down), Math.floor(v / k), v.slice(k). */
  private stepOf(site: ts.Node, sym: ts.Symbol): { kind: 'add' | 'fdiv' | 'slice'; dir: 'up' | 'down'; k: bigint } | null {
    const posLit = (e: ts.Expression): bigint | null => {
      const u = unparen(e);
      if (!ts.isNumericLiteral(u)) return null;
      const n = Number(u.text);
      return Number.isInteger(n) && n >= 1 ? BigInt(n) : null;
    };
    const isV = (e: ts.Expression): boolean => {
      const u = unparen(e);
      return ts.isIdentifier(u) && this.symOf(u) === sym;
    };
    if (ts.isPrefixUnaryExpression(site) || ts.isPostfixUnaryExpression(site))
      return { kind: 'add', dir: site.operator === K.PlusPlusToken ? 'up' : 'down', k: 1n };
    if (!ts.isBinaryExpression(site)) return null;
    const op = site.operatorToken.kind;
    if (op === K.PlusEqualsToken || op === K.MinusEqualsToken) {
      const k = posLit(site.right);
      return k ? { kind: 'add', dir: op === K.PlusEqualsToken ? 'up' : 'down', k } : null;
    }
    if (op !== K.EqualsToken) return null;
    const r = unparen(site.right);
    if (ts.isBinaryExpression(r)) {
      if (r.operatorToken.kind === K.PlusToken) {
        const k = isV(r.left) ? posLit(r.right) : isV(r.right) ? posLit(r.left) : null;
        return k ? { kind: 'add', dir: 'up', k } : null;
      }
      if (r.operatorToken.kind === K.MinusToken && isV(r.left)) {
        const k = posLit(r.right);
        return k ? { kind: 'add', dir: 'down', k } : null;
      }
      return null;
    }
    if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression)) {
      const callee = r.expression;
      if (ts.isIdentifier(callee.expression) && callee.expression.text === 'Math' && callee.name.text === 'floor' && r.arguments.length === 1) {
        const a = unparen(r.arguments[0]!);
        if (ts.isBinaryExpression(a) && a.operatorToken.kind === K.SlashToken && isV(a.left)) {
          const k = posLit(a.right);
          return k && k >= 2n ? { kind: 'fdiv', dir: 'down', k } : null;
        }
      }
      if (callee.name.text === 'slice' && isV(callee.expression) && r.arguments.length === 1) {
        const k = posLit(r.arguments[0]!);
        return k ? { kind: 'slice', dir: 'down', k } : null;
      }
    }
    return null;
  }

  /**
   * Recognized recursion measures. Every self-call is examined with the conditions of the `if`s it sits under
   * (after inlining `let`-bound names). A parameter `p` is a measure when, in every call:
   *  - p is a number passed as `p - k` (k >= 1) under a guard implying `p >= c`, or as `Math.floor(p / k)` (k >= 2)
   *    under a guard implying `p >= 1`; measure (p - c_min + 1).toNat; or
   *  - p is an array/string passed as `p.slice(k)` (k >= 1) under a guard implying `p.length >= 1`; measure p.length.
   * Guards are conjunctions of comparisons with integer literals (`n <= 1` in the else branch counts as `n >= 2`);
   * a lower bound `n >= c` together with `n !== c` counts as `n >= c + 1`.
   * `n === 0` as the only base case does not bound n from below (negative n recurses forever) and is refused.
   */
  private findRecursionMeasure(body: Expr): Measure | null {
    interface Call {
      args: Expr[];
      facts: Array<{ c: Expr; pos: boolean }>;
      lets: Map<string, Expr>;
      node: ts.Node | undefined;
    }
    const calls: Call[] = [];
    const walk = (e: Expr, facts: Array<{ c: Expr; pos: boolean }>, lets: Map<string, Expr>): void => {
      switch (e.e) {
        case 'if':
          walk(e.cond, facts, lets);
          walk(e.then, [...facts, { c: e.cond, pos: true }], lets);
          walk(e.else, [...facts, { c: e.cond, pos: false }], lets);
          return;
        case 'let': {
          walk(e.value, facts, lets);
          walk(e.body, facts, new Map(lets).set(e.name, e.value));
          return;
        }
        case 'call':
          if (e.fn === this.leanName) calls.push({ args: e.args, facts, lets, node: this.selfCallNodes.get(e) });
          for (const a of e.args) walk(a, facts, lets);
          return;
        default:
          for (const c of childrenOf(e)) walk(c, facts, lets);
      }
    };
    walk(body, [], new Map());
    if (calls.length === 0) return null;

    const expand = (e: Expr, lets: Map<string, Expr>, depth = 0): Expr => {
      if (depth > 50) return e;
      if (e.e === 'var' && lets.has(e.name)) return expand(lets.get(e.name)!, lets, depth + 1);
      if (e.e === 'prim') return { ...e, args: e.args.map((a) => expand(a, lets, depth + 1)) };
      return e;
    };
    // Does any guard of any self-call mention a let-bound name? Then the Lean hypotheses mention let variables, and
    // `decreasing_by` must unfold them first (`Measure.unlet`, red-team round 2, r2RecGuardBoolLocal).
    const mentionsLet = (e: Expr, lets: Map<string, Expr>): boolean => {
      let hit = false;
      walkExpr(e, (x) => {
        if (x.e === 'var' && lets.has(x.name)) hit = true;
      });
      return hit;
    };
    const usesLets = calls.some((c) => c.facts.some((f) => mentionsLet(f.c, c.lets)));
    const isAtom = (e: Expr, atom: Expr): boolean => JSON.stringify(e, bigintReplacer) === JSON.stringify(atom, bigintReplacer);
    /** Lower bound on `atom` implied by the facts (`atom >= result`), or undefined. */
    const lowerBound = (atom: Expr, facts: Array<{ c: Expr; pos: boolean }>, lets: Map<string, Expr>, isLength: boolean): bigint | undefined => {
      let best: bigint | undefined = isLength ? 0n : undefined;
      const consider = (b: bigint): void => {
        if (best === undefined || b > best) best = b;
      };
      const visit = (c: Expr, pos: boolean): void => {
        const x = expand(c, lets);
        if (x.e !== 'prim') return;
        if (x.op === 'not') return visit(x.args[0]!, !pos);
        if (x.op === 'and' && pos) {
          visit(x.args[0]!, true);
          visit(x.args[1]!, true);
          return;
        }
        if (x.op === 'or' && !pos) {
          visit(x.args[0]!, false);
          visit(x.args[1]!, false);
          return;
        }
        if (!['lt', 'le', 'gt', 'ge', 'eq', 'ne'].includes(x.op)) return;
        // `s !== ""` (or the negation of `s === ""`) on a string parameter: s.length >= 1 (red-team round 1,
        // recStrNonEmpty). Equality with "" is exact on both sides (JS strings, Lean `List Char` with `[]`).
        if (isLength && atom.e === 'prim' && atom.op === 'strLen' && (x.op === 'eq' || x.op === 'ne')) {
          const base = atom.args[0]!;
          const isEmpty = (y: Expr): boolean => y.e === 'str' && y.value === '';
          const [l0, r0] = [x.args[0]!, x.args[1]!];
          if ((isAtom(l0, base) && isEmpty(r0)) || (isAtom(r0, base) && isEmpty(l0))) {
            if ((x.op === 'ne') === pos) consider(1n);
            return;
          }
        }
        let [l, r] = [x.args[0]!, x.args[1]!];
        let op: PrimOp = x.op;
        if (isAtom(r, atom) && l.e === 'int') {
          [l, r] = [r, l];
          op = ({ lt: 'gt', le: 'ge', gt: 'lt', ge: 'le', eq: 'eq', ne: 'ne' } as Record<string, PrimOp>)[op]!;
        }
        if (!isAtom(l, atom) || r.e !== 'int') return;
        const c0 = r.value;
        if (!pos) op = ({ lt: 'ge', le: 'gt', gt: 'le', ge: 'lt', eq: 'ne', ne: 'eq' } as Record<string, PrimOp>)[op]!;
        if (op === 'gt') consider(c0 + 1n);
        else if (op === 'ge') consider(c0);
        else if (op === 'eq') consider(c0);
        else if (op === 'ne' && isLength && c0 === 0n) consider(1n);
        else if (op === 'ne') excluded.add(c0);
      };
      const excluded = new Set<bigint>();
      for (const f of facts) visit(f.c, f.pos);
      // `atom >= b` and `atom !== b` give `atom >= b + 1` (e.g. `n < 0` throws, `n === 0` returns: n >= 1 below).
      while (best !== undefined && excluded.has(best)) best = best + 1n;
      return best;
    };

    for (let j = 0; j < this.mainParams.length; j++) {
      const p = this.mainParams[j]!;
      const pv: Expr = { e: 'var', ty: p.ty, name: p.name };
      if (p.ty.k === 'int') {
        let minLb: bigint | undefined;
        const hints: MeasureHint[] = [];
        let ok = true;
        for (const call of calls) {
          const a = expand(call.args[j]!, call.lets);
          const lb = lowerBound(pv, call.facts, call.lets, false);
          if (a.e === 'prim' && a.op === 'sub' && isAtom(a.args[0]!, pv) && a.args[1]!.e === 'int' && a.args[1]!.value >= 1n && lb !== undefined) {
            minLb = minLb === undefined || lb < minLb ? lb : minLb;
          } else if (a.e === 'prim' && a.op === 'fdiv' && isAtom(a.args[0]!, pv) && a.args[1]!.e === 'int' && a.args[1]!.value >= 2n && lb !== undefined && lb >= 1n) {
            minLb = minLb === undefined || lb < minLb ? lb : minLb;
            const k = a.args[1]!.value;
            if (!hints.some((h) => h.k === k)) hints.push({ kind: 'fdiv', param: p.name, k });
          } else {
            ok = false;
            break;
          }
        }
        if (ok && minLb !== undefined) {
          const expr = prim('add', INT, [prim('sub', INT, [pv, mkInt(minLb)]), mkInt(1n)]);
          const m: Measure = { kind: 'int', expr, hints, pattern: `\`${p.name}\` decreases on every recursive call and stays >= ${minLb} under the guards` };
          if (usesLets) m.unlet = true;
          return m;
        }
      }
      if (p.ty.k === 'array' || p.ty.k === 'string') {
        const lenAtom: Expr = { e: 'prim', ty: INT, op: p.ty.k === 'array' ? 'len' : 'strLen', args: [pv] };
        const hints: MeasureHint[] = [];
        let ok = true;
        for (const call of calls) {
          const a = expand(call.args[j]!, call.lets);
          const lb = lowerBound(lenAtom, call.facts, call.lets, true);
          if (a.e === 'prim' && (a.op === 'sliceFrom' || a.op === 'strSliceFrom') && isAtom(a.args[0]!, pv) && a.args[1]!.e === 'int' && a.args[1]!.value >= 1n && lb !== undefined && lb >= 1n) {
            const k = a.args[1]!.value;
            if (!hints.some((h) => h.k === k)) hints.push({ kind: 'slice', param: p.name, k });
          } else {
            ok = false;
            break;
          }
        }
        if (ok) {
          const m: Measure = { kind: 'length', param: p.name, hints, pattern: `\`${p.name}\` shrinks (slice(k), k >= 1) on every recursive call and is non-empty under the guards` };
          if (usesLets) m.unlet = true;
          return m;
        }
      }
    }
    refuse(
      'no-termination-measure',
      'no termination measure found for this recursion. Recognized: a number parameter n passed as n - k (k >= 1) under a guard like `n > 0` or `n >= c` ' +
        '(or Math.floor(n / k), k >= 2, under n >= 1); an array/string parameter xs passed as xs.slice(k) (k >= 1) under `xs.length > 0`. ' +
        'A base case `n === 0` alone does not bound n from below (negative n never stops)',
      calls[0]!.node ?? this.fnNode,
    );
  }

  // ------------------------------------------------------------------------------------------------------------
  // Expressions
  // ------------------------------------------------------------------------------------------------------------

  private cond(node: ts.Expression, env: Env, ctx: Ctx): Expr {
    const c = this.expr(node, env, ctx);
    if (c.ty.k !== 'bool')
      refuse('unsupported-syntax', 'this condition is not a boolean (truthiness of numbers, strings and arrays is outside subset v1; compare explicitly)', node);
    return c;
  }

  private toStr(e: Expr, at: ts.Node): Expr {
    if (e.ty.k === 'string') return e;
    if (e.ty.k === 'int') return prim('intToStr', STR, [e]);
    if (e.ty.k === 'bool') return prim('boolToStr', STR, [e]);
    refuse('unsupported-syntax', 'converting an array or record to a string is outside subset v1', at);
  }

  private plus(a: Expr, b: Expr, site: Site, at: ts.Node): Expr {
    if (a.ty.k === 'int' && b.ty.k === 'int') return prim('add', INT, [a, b], site);
    if (a.ty.k === 'string' || b.ty.k === 'string') return prim('strConcat', STR, [this.toStr(a, at), this.toStr(b, at)], site);
    refuse('unsupported-syntax', '`+` on these operand types is outside subset v1 (numbers or strings only)', at);
  }

  private arith(op: PrimOp, a: Expr, b: Expr, site: Site, at: ts.Node): Expr {
    if (a.ty.k !== 'int' || b.ty.k !== 'int') refuse('unsupported-syntax', `arithmetic on non-numbers is outside subset v1`, at);
    return prim(op, INT, [a, b], site);
  }

  private literalInt(n: ts.NumericLiteral, negate: boolean): Expr {
    const text = n.text.replace(/_/g, '');
    let v: bigint;
    if (/^[0-9]+$/.test(text) || /^0[xXoObB][0-9a-fA-F]+$/.test(text)) v = BigInt(text);
    else {
      const num = Number(text);
      if (!Number.isInteger(num)) refuse('float', `the number literal ${n.getText(this.sf)} is not an integer`, n);
      if (Math.abs(num) > 2 ** 53) refuse('unsupported-syntax', `the integer literal ${n.getText(this.sf)} is outside ±2^53`, n);
      v = BigInt(num);
    }
    if (negate) v = -v;
    if (v > TWO53 || v < -TWO53) refuse('unsupported-syntax', `the integer literal ${n.getText(this.sf)} is outside ±2^53`, n);
    return mkInt(v);
  }

  private selfCall(node: ts.CallExpression, env: Env, ctx: Ctx): Expr {
    if (ctx.cb) refuse('no-termination-measure', 'a recursive call inside a callback is outside subset v1 (no termination measure)', node);
    if (ctx.inLoop) refuse('no-termination-measure', 'a recursive call inside a loop is outside subset v1 (no termination measure)', node);
    if (node.arguments.length !== this.mainParams.length) refuse('unsupported-syntax', 'recursive call with a different number of arguments', node);
    const args = node.arguments.map((a, i) => {
      const v = this.expr(a, env, ctx);
      if (!tyEq(v.ty, this.mainParams[i]!.ty)) refuse('unsupported-type', 'recursive call argument has a different type', a);
      return v;
    });
    const e: Expr = { e: 'call', ty: this.mainRet, fn: this.leanName, args, site: this.site(node) };
    this.selfCallNodes.set(e, node);
    return e;
  }

  private ident(id: ts.Identifier, env: Env, ctx: Ctx): Expr {
    const sym = this.symOf(id);
    if (sym) {
      const b = env.get(sym);
      if (b) {
        if (ctx.cb && ctx.cb.outer.has(sym) && this.mutable.has(sym))
          refuse('mutable-capture', `the callback reads \`${id.text}\`, a variable the function reassigns (closure over mutable state)`, id);
        return mkVar(b);
      }
      if (sym === this.fnSymbol) refuse('unsupported-syntax', 'the function used as a value is outside subset v1', id);
      const decl = sym.valueDeclaration ?? sym.declarations?.[0];
      if (decl && decl.getSourceFile() === this.sf) {
        if (this.isLocal(sym)) refuse('unsupported-syntax', `\`${id.text}\` is used outside its scope`, id);
        if (ts.isFunctionDeclaration(decl)) refuse('unsupported-syntax', 'calls to other functions are outside subset v1', id);
        if (ts.isVariableDeclaration(decl)) {
          const list = decl.parent;
          const isConst = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
          const init = decl.initializer ? unparen(decl.initializer) : undefined;
          if (isConst && init && ts.isVariableStatement(list.parent)) {
            const lit = this.moduleLiteral(init);
            if (lit) {
              if (id.text === '__faithful')
                refuse('unsupported-syntax', '`__faithful` is reserved: it names the range-check runtime that the instrumented original runs beside', decl);
              // the whole statement is copied into instrumentedTs/plainTs: every declarator must be a literal too
              for (const other of list.declarations) {
                const oi = other.initializer ? unparen(other.initializer) : undefined;
                if (other !== decl && (!oi || !ts.isIdentifier(other.name) || !this.moduleLiteral(oi)))
                  refuse('mutable-capture', `\`${id.text}\` is declared together with a module-level binding that is not a literal constant; declare it in its own \`const\` statement`, other);
              }
              this.checkModuleConstStatement(list.parent);
              this.moduleConsts.set(sym, { stmt: list.parent, value: lit });
              return lit;
            }
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) refuse('unsupported-syntax', 'calls to other functions are outside subset v1', id);
          }
          refuse('mutable-capture', `\`${id.text}\` is module-level state (only module-level \`const\` number/string/boolean literals are supported)`, id);
        }
        if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl))
          refuse('mutable-capture', `\`${id.text}\` is imported; free variables other than literal constants are outside subset v1`, id);
        refuse('unsupported-syntax', `\`${id.text}\` is outside subset v1`, id);
      }
    }
    if (id.text === 'undefined') refuse('unsupported-type', '`undefined` is supported only as the returned value of a `T | undefined` function', id);
    if (id.text === 'arguments') refuse('unsupported-syntax', '`arguments` is outside subset v1', id);
    refuse('unsupported-library', `the global \`${id.text}\` is outside subset v1`, id);
  }

  /**
   * A module constant the function reads is inlined into the model and its statement is copied verbatim into
   * plainTs/instrumentedTs, so it must be valid (red-team round 4, r4ModuleOctalConstRead / r4ModuleLeadingZeroConstRead
   * / r4ModuleOctalEscapeConstRead): `010`, `09`, `"a\1b"` and `1__0` are TypeScript errors (TS1121, TS1489, TS1487,
   * TS6189) and SyntaxErrors in a strict ES module, which therefore never loads, while `moduleLiteral` would read their
   * sloppy-mode value. Any error diagnostic starting in the statement (leading trivia included), or a comment directive
   * there that could hide one, refuses.
   */
  private checkModuleConstStatement(stmt: ts.VariableStatement): void {
    const d = this.fileDiags.find((x) => x.start !== undefined && x.start >= stmt.pos && x.start < stmt.end);
    if (d)
      refuse('unsupported-syntax', `a module-level constant the function reads does not type-check (it may not even load as a strict ES module): TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`, {
        start: d.start!,
        end: d.start! + (d.length ?? 0),
      });
    const c = findLineDirectiveFor(this.sf, stmt);
    if (c) refuse('unsupported-syntax', 'a `@ts-ignore` / `@ts-expect-error` comment on a module-level constant the function reads can hide TypeScript errors the translator relies on; remove it', c);
  }

  private moduleLiteral(init: ts.Expression): Expr | null {
    if (ts.isNumericLiteral(init)) {
      const v = Number(init.text.replace(/_/g, ''));
      if (!Number.isInteger(v)) refuse('float', `the number literal ${init.getText(this.sf)} is not an integer`, init);
      return this.literalInt(init, false);
    }
    if (ts.isPrefixUnaryExpression(init) && init.operator === K.MinusToken && ts.isNumericLiteral(unparen(init.operand)))
      return this.literalInt(unparen(init.operand) as ts.NumericLiteral, true);
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
      // the same BMP rule scan.ts applies to literals inside the function (red-team round 1, refuseModuleAstral)
      if (hasSurrogate(init.text))
        refuse('non-bmp', 'this module-level string constant contains characters outside the Basic Multilingual Plane (or a lone surrogate); strings are modeled as BMP text', init);
      return mkStr(init.text);
    }
    if (init.kind === K.TrueKeyword) return mkBool(true);
    if (init.kind === K.FalseKeyword) return mkBool(false);
    return null;
  }

  expr(node: ts.Expression, env: Env, ctx: Ctx): Expr {
    const e = this.expr0(node, env, ctx);
    return this.count(e);
  }

  private expr0(node: ts.Expression, env: Env, ctx: Ctx): Expr {
    switch (node.kind) {
      case K.ParenthesizedExpression:
      case K.NonNullExpression:
      case K.SatisfiesExpression:
        return this.expr((node as ts.ParenthesizedExpression).expression, env, ctx);
      case K.NumericLiteral:
        return this.literalInt(node as ts.NumericLiteral, false);
      case K.BigIntLiteral:
        refuse('unsupported-type', 'bigint literals are outside subset v1', node);
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
        return mkStr((node as ts.StringLiteral).text);
      case K.TrueKeyword:
        return mkBool(true);
      case K.FalseKeyword:
        return mkBool(false);
      case K.NullKeyword:
        refuse('unsupported-type', '`null` is supported only as the returned value of a `T | null` function', node);
      case K.TemplateExpression: {
        const t = node as ts.TemplateExpression;
        // Left-nested concatenation; only the outermost one carries the length check (`checkOf` in ir.ts: JavaScript
        // evaluates all substitutions, then concatenates once).
        let acc: Expr | null = t.head.text ? mkStr(t.head.text) : null;
        const cat = (x: Expr): void => {
          acc = acc ? { e: 'prim', ty: STR, op: 'strConcat', args: [acc, x], unchecked: true } : x;
        };
        for (const span of t.templateSpans) {
          cat(this.toStr(this.expr(span.expression, env, ctx), span.expression));
          if (span.literal.text) cat(mkStr(span.literal.text));
        }
        const res: Expr = acc ?? mkStr('');
        if (res.e === 'prim' && res.op === 'strConcat') return { e: 'prim', ty: STR, op: 'strConcat', args: res.args, site: this.site(t) };
        return res;
      }
      case K.Identifier:
        return this.ident(node as ts.Identifier, env, ctx);
      case K.PrefixUnaryExpression: {
        const p = node as ts.PrefixUnaryExpression;
        if (p.operator === K.MinusToken) {
          const o = unparen(p.operand);
          if (ts.isNumericLiteral(o)) return this.literalInt(o, true);
          const v = this.expr(p.operand, env, ctx);
          if (v.ty.k !== 'int') refuse('unsupported-syntax', 'unary minus on a non-number', p);
          return prim('neg', INT, [v], this.site(p));
        }
        if (p.operator === K.PlusToken) {
          const v = this.expr(p.operand, env, ctx);
          if (v.ty.k !== 'int') refuse('unsupported-syntax', 'unary `+` (numeric conversion) is outside subset v1', p);
          return v;
        }
        if (p.operator === K.ExclamationToken) {
          const v = this.expr(p.operand, env, ctx);
          if (v.ty.k !== 'bool') refuse('unsupported-syntax', '`!` on a non-boolean (truthiness) is outside subset v1', p);
          return prim('not', BOOL, [v]);
        }
        refuse('unsupported-syntax', '++/-- inside an expression is outside subset v1 (use it as a statement)', p);
      }
      case K.PostfixUnaryExpression:
        refuse('unsupported-syntax', '++/-- inside an expression is outside subset v1 (use it as a statement)', node);
      case K.BinaryExpression:
        return this.binary(node as ts.BinaryExpression, env, ctx);
      case K.ConditionalExpression: {
        const c = node as ts.ConditionalExpression;
        const cond = this.cond(c.condition, env, ctx);
        const a = this.expr(c.whenTrue, env, ctx);
        const b = this.expr(c.whenFalse, env, ctx);
        if (!tyEq(a.ty, b.ty)) refuse('unsupported-type', 'the branches of this conditional have different types', c);
        return { e: 'if', ty: a.ty, cond, then: a, else: b };
      }
      case K.ArrayLiteralExpression: {
        const a = node as ts.ArrayLiteralExpression;
        for (const el of a.elements) {
          if (ts.isSpreadElement(el)) refuse('unsupported-syntax', 'spread (...) is outside subset v1', el);
          if (ts.isOmittedExpression(el)) refuse('unsupported-syntax', 'array holes are outside subset v1', a);
        }
        const ty = this.literalTy(a, 'array');
        if (ty.k === 'tuple') {
          if (ty.elems.length !== a.elements.length) refuse('unsupported-type', 'tuple literal of the wrong length', a);
          const elems = a.elements.map((el, i) => {
            const v = this.expr(el, env, ctx);
            if (!tyEq(v.ty, ty.elems[i]!)) refuse('unsupported-type', 'tuple element of the wrong type', el);
            return v;
          });
          return { e: 'tuple', ty, elems };
        }
        if (ty.k !== 'array') refuse('unsupported-type', 'array literal of a non-array type', a);
        const elems = a.elements.map((el) => {
          const v = this.expr(el, env, ctx);
          if (!tyEq(v.ty, ty.elem)) refuse('unsupported-type', 'array element of the wrong type', el);
          return v;
        });
        return { e: 'list', ty, elems };
      }
      case K.ObjectLiteralExpression: {
        const o = node as ts.ObjectLiteralExpression;
        const ty = this.literalTy(o, 'record');
        if (ty.k !== 'record') refuse('unsupported-type', 'object literal of a non-record type', o);
        const fields: Array<{ name: string; value: Expr }> = [];
        for (const p of o.properties) {
          let name: string;
          let value: Expr;
          if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
            name = p.name.text;
            value = this.expr(p.initializer, env, ctx);
          } else if (ts.isShorthandPropertyAssignment(p)) {
            name = p.name.text;
            value = this.ident(p.name, env, ctx);
          } else if (ts.isSpreadAssignment(p)) refuse('unsupported-syntax', 'object spread (...) is outside subset v1', p);
          else refuse('unsupported-syntax', 'computed keys, methods and accessors in object literals are outside subset v1', p);
          const f = ty.fields.find((x) => x.name === name);
          if (!f) refuse('unsupported-type', `the field \`${name}\` is not part of the record type`, p);
          if (!tyEq(value.ty, f.ty)) refuse('unsupported-type', `the field \`${name}\` has the wrong type`, p);
          fields.push({ name, value });
        }
        if (fields.length !== ty.fields.length) refuse('unsupported-type', 'the object literal does not set every field of its record type', o);
        return { e: 'record', ty, fields };
      }
      case K.PropertyAccessExpression:
        return this.propAccess(node as ts.PropertyAccessExpression, env, ctx);
      case K.ElementAccessExpression: {
        const ea = node as ts.ElementAccessExpression;
        if (ea.questionDotToken) refuse('unsupported-syntax', 'optional chaining (?.) is outside subset v1', ea);
        const recv = this.expr(ea.expression, env, ctx);
        if (recv.ty.k === 'tuple') {
          const ix = unparen(ea.argumentExpression);
          if (!ts.isNumericLiteral(ix)) refuse('unsupported-syntax', 'tuples can only be indexed with a literal', ea.argumentExpression);
          const i = Number(ix.text);
          if (!Number.isInteger(i) || i < 0 || i >= recv.ty.elems.length) refuse('unsupported-syntax', 'tuple index out of range', ix);
          return { e: 'proj', ty: recv.ty.elems[i]!, tuple: recv, index: i };
        }
        if (recv.ty.k === 'record') {
          const key = unparen(ea.argumentExpression);
          if (!ts.isStringLiteral(key) && !ts.isNoSubstitutionTemplateLiteral(key)) refuse('unsupported-syntax', 'records can only be indexed with a literal field name', ea.argumentExpression);
          const f = recv.ty.fields.find((x) => x.name === key.text);
          if (!f) refuse('unsupported-syntax', `\`${key.text}\` is not a field of this record`, key);
          return { e: 'field', ty: f.ty, rec: recv, name: key.text };
        }
        const idx = this.expr(ea.argumentExpression, env, ctx);
        if (idx.ty.k !== 'int') refuse('unsupported-syntax', 'index is not a number', ea.argumentExpression);
        if (recv.ty.k === 'array') return prim('at', recv.ty.elem, [recv, idx], this.site(ea));
        if (recv.ty.k === 'string') return prim('strAt', STR, [recv, idx], this.site(ea));
        refuse('unsupported-syntax', 'indexing a record is outside subset v1 (use .field)', ea);
      }
      case K.CallExpression:
        return this.call(node as ts.CallExpression, env, ctx);
      case K.NewExpression: {
        const n = node as ts.NewExpression;
        if (ts.isIdentifier(n.expression) && n.expression.text === 'Array') refuse('unsupported-library', '`new Array(...)` is outside subset v1', n);
        if (ts.isIdentifier(n.expression) && n.expression.text === 'Error') refuse('unsupported-syntax', '`new Error` is supported only directly in `throw`', n);
        refuse('unsupported-syntax', '`new` (objects and classes) is outside subset v1', n);
      }
      case K.ArrowFunction:
      case K.FunctionExpression:
        refuse('unsupported-syntax', 'function values are outside subset v1 (callbacks are accepted only as arguments of map/filter/reduce/sort)', node);
      case K.AsExpression:
      case K.TypeAssertionExpression:
        refuse('unsupported-syntax', 'type assertions (`as`) are outside subset v1', node);
      case K.TypeOfExpression:
        refuse('unsupported-syntax', '`typeof` is outside subset v1', node);
      case K.DeleteExpression:
      case K.VoidExpression:
        refuse('unsupported-syntax', `\`${node.getText(this.sf).split(/\s/)[0]}\` is outside subset v1`, node);
      case K.ThisKeyword:
        refuse('this', '`this` is outside subset v1', node);
      case K.TaggedTemplateExpression:
        refuse('unsupported-syntax', 'tagged templates are outside subset v1', node);
      case K.SpreadElement:
        refuse('unsupported-syntax', 'spread (...) is outside subset v1', node);
      case K.ClassExpression:
        refuse('unsupported-syntax', 'classes are outside subset v1', node);
      default:
        refuse('unsupported-syntax', `${ts.SyntaxKind[node.kind]} is outside subset v1`, node);
    }
  }

  private binary(b: ts.BinaryExpression, env: Env, ctx: Ctx): Expr {
    const op = b.operatorToken.kind;
    if (op >= K.FirstAssignment && op <= K.LastAssignment)
      refuse('unsupported-syntax', 'assignment inside an expression is outside subset v1 (use a statement)', b);
    if (op === K.CommaToken) refuse('unsupported-syntax', 'the comma operator is outside subset v1', b.operatorToken);
    if (op === K.QuestionQuestionToken) refuse('unsupported-syntax', '`??` is outside subset v1', b.operatorToken);
    if (op === K.InKeyword || op === K.InstanceOfKeyword) refuse('unsupported-syntax', `\`${b.operatorToken.getText(this.sf)}\` is outside subset v1`, b.operatorToken);
    if (op === K.AsteriskAsteriskToken) refuse('unsupported-syntax', '`**` is outside subset v1', b.operatorToken);
    if (op === K.SlashToken) refuse('float', '`a / b` is not provably an integer; use Math.floor(a / b) or Math.ceil(a / b)', b);
    const isNull = (e: ts.Expression): boolean => {
      const u = unparen(e);
      return u.kind === K.NullKeyword || (ts.isIdentifier(u) && u.text === 'undefined' && this.isLibGlobal(u));
    };
    if (
      (op === K.EqualsEqualsEqualsToken || op === K.ExclamationEqualsEqualsToken || op === K.EqualsEqualsToken || op === K.ExclamationEqualsToken) &&
      (isNull(b.left) || isNull(b.right))
    )
      refuse('unsupported-syntax', 'comparison with null/undefined is outside subset v1 (only a returned value may be null)', b);
    if (op === K.AmpersandAmpersandToken || op === K.BarBarToken) {
      const l = this.expr(b.left, env, ctx);
      const rightHasCall = this.containsSelfCall(b.right);
      const r = this.expr(b.right, env, ctx);
      if (l.ty.k !== 'bool' || r.ty.k !== 'bool')
        refuse('unsupported-syntax', `\`${b.operatorToken.getText(this.sf)}\` on non-booleans returns an operand, not a boolean; it is outside subset v1`, b);
      if (rightHasCall)
        return op === K.AmpersandAmpersandToken ? { e: 'if', ty: BOOL, cond: l, then: r, else: mkBool(false) } : { e: 'if', ty: BOOL, cond: l, then: mkBool(true), else: r };
      return prim(op === K.AmpersandAmpersandToken ? 'and' : 'or', BOOL, [l, r]);
    }
    const l = this.expr(b.left, env, ctx);
    const r = this.expr(b.right, env, ctx);
    const site = this.site(b);
    switch (op) {
      case K.PlusToken:
        return this.plus(l, r, site, b);
      case K.MinusToken:
        return this.arith('sub', l, r, site, b);
      case K.AsteriskToken:
        return this.arith('mul', l, r, site, b);
      case K.PercentToken:
        this.notes.add('JS % is truncated (sign of the dividend): modeled as Int.tmod, never Lean %');
        return this.arith('tmod', l, r, site, b);
      case K.LessThanToken:
      case K.LessThanEqualsToken:
      case K.GreaterThanToken:
      case K.GreaterThanEqualsToken: {
        if (!((l.ty.k === 'int' && r.ty.k === 'int') || (l.ty.k === 'string' && r.ty.k === 'string')))
          refuse('unsupported-syntax', 'ordering comparison is supported on two numbers or two strings only', b);
        if (l.ty.k === 'string') this.notes.add('string < compares UTF-16 code units (= code points for BMP text)');
        const m: Record<number, PrimOp> = { [K.LessThanToken]: 'lt', [K.LessThanEqualsToken]: 'le', [K.GreaterThanToken]: 'gt', [K.GreaterThanEqualsToken]: 'ge' };
        return prim(m[op]!, BOOL, [l, r]);
      }
      case K.EqualsEqualsEqualsToken:
      case K.ExclamationEqualsEqualsToken:
      case K.EqualsEqualsToken:
      case K.ExclamationEqualsToken: {
        if (!['int', 'bool', 'string'].includes(l.ty.k) || !['int', 'bool', 'string'].includes(r.ty.k))
          refuse('unsupported-syntax', 'equality on arrays, tuples or records compares references in JavaScript; it is outside subset v1', b);
        if (!tyEq(l.ty, r.ty)) refuse('unsupported-syntax', 'equality between values of different types is outside subset v1', b);
        const neg = op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken;
        return prim(neg ? 'ne' : 'eq', BOOL, [l, r]);
      }
      default:
        refuse('unsupported-syntax', `the operator \`${b.operatorToken.getText(this.sf)}\` is outside subset v1`, b.operatorToken);
    }
  }

  private propAccess(pa: ts.PropertyAccessExpression, env: Env, ctx: Ctx): Expr {
    if (pa.questionDotToken) refuse('unsupported-syntax', 'optional chaining (?.) is outside subset v1', pa);
    if (ts.isIdentifier(pa.expression)) {
      const g = pa.expression.text;
      if (this.isLibGlobal(pa.expression) && ['Math', 'Number', 'String', 'Array', 'Object', 'JSON'].includes(g))
        refuse('unsupported-library', `${g}.${pa.name.text} is outside subset v1`, pa);
    }
    const recv = this.expr(pa.expression, env, ctx);
    const name = pa.name.text;
    if (name === 'length') {
      if (recv.ty.k === 'string') return prim('strLen', INT, [recv]);
      if (recv.ty.k === 'array') return prim('len', INT, [recv]);
      if (recv.ty.k === 'tuple') return mkInt(BigInt(recv.ty.elems.length));
    }
    if (recv.ty.k === 'record') {
      const f = recv.ty.fields.find((x) => x.name === name);
      if (!f) refuse('unsupported-syntax', `\`${name}\` is not a field of this record`, pa.name);
      return { e: 'field', ty: f.ty, rec: recv, name };
    }
    const owner = recv.ty.k === 'string' ? 'String.prototype' : recv.ty.k === 'array' ? 'Array.prototype' : recv.ty.k;
    refuse('unsupported-library', `${owner}.${name} is outside subset v1`, pa.name);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Calls
  // ------------------------------------------------------------------------------------------------------------

  private call(c: ts.CallExpression, env: Env, ctx: Ctx): Expr {
    if (c.questionDotToken) refuse('unsupported-syntax', 'optional call (?.) is outside subset v1', c);
    for (const a of c.arguments) if (ts.isSpreadElement(a)) refuse('unsupported-syntax', 'spread arguments (...) are outside subset v1', a);
    const callee = c.expression;
    if (ts.isIdentifier(callee)) {
      if (this.isSelf(callee)) return this.selfCall(c, env, ctx);
      const sym = this.symOf(callee);
      const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
      if (decl && decl.getSourceFile() === this.sf) {
        if (sym && env.has(sym)) refuse('unsupported-syntax', 'calling a function value is outside subset v1', c);
        refuse('unsupported-syntax', 'calls to other functions are outside subset v1', c);
      }
      if (callee.text === 'Error') refuse('unsupported-syntax', '`Error(...)` is supported only directly in `throw`', c);
      refuse('unsupported-library', `\`${callee.text}(...)\` is outside subset v1`, c);
    }
    if (!ts.isPropertyAccessExpression(callee)) refuse('unsupported-syntax', 'this kind of call is outside subset v1', c);
    const m = callee.name.text;
    if (ts.isIdentifier(callee.expression) && callee.expression.text === 'Math' && this.isLibGlobal(callee.expression)) return this.mathCall(c, m, env, ctx);
    if (ts.isIdentifier(callee.expression)) {
      const g = callee.expression.text;
      if (this.isLibGlobal(callee.expression) && ['Number', 'String', 'Array', 'Object', 'JSON', 'Boolean', 'Symbol', 'BigInt', 'Reflect', 'Intl'].includes(g))
        refuse('unsupported-library', `${g}.${m} is outside subset v1`, c);
    }
    const recv = this.expr(callee.expression, env, ctx);
    const args = c.arguments;
    const site = this.site(c);
    const nArgs = (lo: number, hi: number, what: string): void => {
      if (args.length < lo || args.length > hi) refuse('unsupported-library', `${what} with ${args.length} argument(s) is outside subset v1`, c);
    };
    const intArg = (i: number): Expr => {
      const v = this.expr(args[i]!, env, ctx);
      if (v.ty.k !== 'int') refuse('unsupported-syntax', 'expected a number argument', args[i]!);
      return v;
    };
    const strArg = (i: number): Expr => {
      const v = this.expr(args[i]!, env, ctx);
      if (v.ty.k !== 'string') refuse('unsupported-syntax', 'expected a string argument', args[i]!);
      return v;
    };
    if (recv.ty.k === 'string') {
      switch (m) {
        case 'charAt':
          nArgs(1, 1, 'charAt');
          return prim('charAt', STR, [recv, intArg(0)]);
        case 'charCodeAt':
          nArgs(1, 1, 'charCodeAt');
          return prim('charCodeAt', INT, [recv, intArg(0)], site);
        case 'slice':
          nArgs(0, 2, 'slice');
          if (args.length === 0) return prim('strSliceFrom', STR, [recv, mkInt(0n)]);
          if (args.length === 1) return prim('strSliceFrom', STR, [recv, intArg(0)]);
          {
            const a = intArg(0);
            return prim('strSlice', STR, [recv, a, intArg(1)]);
          }
        case 'indexOf': {
          nArgs(1, 2, 'indexOf');
          const sub = strArg(0);
          return prim('strIndexOf', INT, [recv, sub, args.length === 2 ? intArg(1) : mkInt(0n)]);
        }
        case 'split':
          if (args.length === 0) refuse('unsupported-library', 'split() without a separator is outside subset v1', c);
          nArgs(1, 1, 'split with a limit');
          return prim('split', { k: 'array', elem: STR }, [recv, strArg(0)]);
        case 'toLowerCase':
        case 'toUpperCase':
          nArgs(0, 0, m);
          this.usesAscii = true;
          this.notes.add('toLowerCase/toUpperCase are modeled on ASCII letters only (ascii precondition)');
          return prim(m === 'toLowerCase' ? 'toLower' : 'toUpper', STR, [recv], site);
        default:
          refuse('unsupported-library', `String.prototype.${m} is outside subset v1`, callee.name);
      }
    }
    if (recv.ty.k === 'array') {
      const at = recv.ty;
      const elem = at.elem;
      switch (m) {
        case 'slice':
          nArgs(0, 2, 'slice');
          if (args.length === 0) return prim('sliceFrom', at, [recv, mkInt(0n)]);
          if (args.length === 1) return prim('sliceFrom', at, [recv, intArg(0)]);
          {
            const a = intArg(0);
            return prim('slice', at, [recv, a, intArg(1)]);
          }
        case 'concat': {
          let acc = recv;
          for (const a of args) {
            const v = this.expr(a, env, ctx);
            if (!tyEq(v.ty, at)) refuse('unsupported-syntax', 'concat is supported only with arguments that are arrays of the same type (JavaScript spreads array arguments and appends others)', a);
            acc = prim('concat', at, [acc, v]);
          }
          return acc;
        }
        case 'indexOf':
        case 'includes': {
          nArgs(1, 1, `${m} with a start index`);
          if (!['int', 'bool', 'string'].includes(elem.k)) refuse('unsupported-syntax', `${m} on arrays of arrays/tuples/records compares references; it is outside subset v1`, c);
          const x = this.expr(args[0]!, env, ctx);
          if (!tyEq(x.ty, elem)) refuse('unsupported-syntax', `${m} argument has a different type than the elements`, args[0]!);
          return prim(m === 'indexOf' ? 'indexOf' : 'includes', m === 'indexOf' ? INT : BOOL, [recv, x]);
        }
        case 'join': {
          nArgs(0, 1, 'join');
          const sep = args.length === 1 ? strArg(0) : mkStr(',');
          let strs = recv;
          if (elem.k === 'int' || elem.k === 'bool') {
            const x: IrParam = { name: ctx.names.fresh('x'), ty: elem };
            const lam: Expr = { e: 'lam', ty: { k: 'array', elem: STR }, params: [x], body: prim(elem.k === 'int' ? 'intToStr' : 'boolToStr', STR, [mkVar(x)]) };
            strs = prim('map', { k: 'array', elem: STR }, [recv, lam]);
          } else if (elem.k !== 'string') refuse('unsupported-syntax', 'join on arrays of arrays/tuples/records is outside subset v1', c);
          return prim('join', STR, [strs, sep], site);
        }
        case 'map':
        case 'filter': {
          nArgs(1, 1, `${m} with a thisArg`);
          const outTy = m === 'map' ? this.tyAt(c, 'the result of map') : at;
          const cbRet = m === 'map' ? (outTy as Extract<Ty, { k: 'array' }>).elem : BOOL;
          if (m === 'map' && outTy.k !== 'array') refuse('unsupported-type', 'map result is not an array', c);
          const lam = this.lambda(args[0]!, [elem, INT], cbRet, env, ctx, m);
          const indexed = (lam as { params: IrParam[] }).params.length === 2;
          return prim(m === 'map' ? (indexed ? 'mapI' : 'map') : indexed ? 'filterI' : 'filter', outTy, [recv, lam]);
        }
        case 'reduce': {
          if (args.length !== 2) refuse('unsupported-library', 'reduce without an initial value is outside subset v1 (pass the initial value)', c);
          const accTy = this.tyAt(c, 'the result of reduce');
          const init = this.expr(args[1]!, env, ctx);
          if (!tyEq(init.ty, accTy)) refuse('unsupported-type', 'reduce initial value has a different type than the result', args[1]!);
          const lam = this.lambda(args[0]!, [accTy, elem, INT], accTy, env, ctx, 'reduce', 2);
          const indexed = (lam as { params: IrParam[] }).params.length === 3;
          return prim(indexed ? 'foldlI' : 'foldl', accTy, [recv, lam, init]);
        }
        case 'sort':
          return this.sort(c, recv, env, ctx);
        default:
          refuse('unsupported-library', `Array.prototype.${m} is outside subset v1`, callee.name);
      }
    }
    refuse('unsupported-library', `.${m}(...) on a ${recv.ty.k} is outside subset v1`, callee.name);
  }

  private mathCall(c: ts.CallExpression, m: string, env: Env, ctx: Ctx): Expr {
    const args = c.arguments;
    const site = this.site(c);
    const intArg = (a: ts.Expression): Expr => {
      const v = this.expr(a, env, ctx);
      if (v.ty.k !== 'int') refuse('unsupported-syntax', `Math.${m} of a non-number`, a);
      return v;
    };
    switch (m) {
      case 'floor':
      case 'ceil': {
        if (args.length !== 1) refuse('unsupported-library', `Math.${m} takes one argument`, c);
        const a = unparen(args[0]!);
        if (ts.isBinaryExpression(a) && a.operatorToken.kind === K.SlashToken) {
          const x = intArg(a.left);
          const y = intArg(a.right);
          this.notes.add(m === 'floor' ? 'Math.floor(a / b) is modeled as Int.fdiv a b' : 'Math.ceil(a / b) is modeled as -(Int.fdiv (-a) b)');
          return prim(m === 'floor' ? 'fdiv' : 'cdiv', INT, [x, y], site);
        }
        return intArg(args[0]!); // floor/ceil of an integer is itself
      }
      case 'abs':
        if (args.length !== 1) refuse('unsupported-library', 'Math.abs takes one argument', c);
        return prim('abs', INT, [intArg(args[0]!)]);
      case 'min':
      case 'max': {
        if (args.length === 0) refuse('unsupported-library', `Math.${m}() without arguments is ${m === 'min' ? 'Infinity' : '-Infinity'}`, c);
        let acc = intArg(args[0]!);
        for (const a of args.slice(1)) acc = prim(m, INT, [acc, intArg(a)]);
        return acc;
      }
      default:
        refuse('unsupported-library', `Math.${m} is outside subset v1`, c);
    }
  }

  /** Lower an inline callback. `paramTys` are the types of the callback's possible parameters, in order. */
  private lambda(node: ts.Expression, paramTys: Ty[], retTy: Ty, env: Env, ctx: Ctx, what: string, minParams = 1): Expr {
    const fn = unparen(node);
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn))
      refuse('unsupported-syntax', `the ${what} callback must be an inline arrow function`, node);
    // Red-team round 3 (r3ThisParamMap/Filter/Reduce): a TypeScript `this` pseudo-parameter is erased at run time, so it
    // takes no argument position. Binding parameters positionally with it in the list shifted every real parameter by
    // one (`x` became the index). A `this` parameter together with value parameters is refused. A `this` parameter
    // alone binds the element position to a name the body can never read (`this` in the body is refused by
    // scanFeatures), which is exactly a callback that ignores its arguments, so it is kept.
    const thisParam = fn.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === 'this');
    if (thisParam && fn.parameters.length > 1)
      refuse(
        'this',
        `a \`this\` parameter on the ${what} callback is outside subset v1 (TypeScript erases it, so it takes no argument position; declare the callback without it)`,
        thisParam,
      );
    if (fn.parameters.length > paramTys.length)
      refuse('unsupported-library', `the ${what} callback's parameter \`${fn.parameters[paramTys.length]!.name.getText(this.sf)}\` (the array itself) is outside subset v1`, fn.parameters[paramTys.length]!);
    if (fn.parameters.length < minParams) refuse('unsupported-syntax', `the ${what} callback must name its parameters`, fn);
    const outer = new Set(env.keys());
    const env2: Env = new Map(env);
    const params: IrParam[] = fn.parameters.map((p, i) => {
      if (!ts.isIdentifier(p.name)) refuse('unsupported-syntax', 'destructuring parameters are outside subset v1', p.name);
      if (p.initializer || p.dotDotDotToken) refuse('unsupported-syntax', 'default and rest parameters are outside subset v1', p);
      const sym = this.checker.getSymbolAtLocation(p.name)!;
      const declared = this.tyOfType(this.checker.getTypeOfSymbolAtLocation(sym, p.name), p.type ?? p.name, `callback parameter \`${p.name.text}\``);
      if (!tyEq(declared, paramTys[i]!)) refuse('unsupported-type', `callback parameter \`${p.name.text}\` has an unexpected type`, p);
      const b = { name: ctx.names.fresh(p.name.text), ty: paramTys[i]! };
      env2.set(sym, b);
      return b;
    });
    const cctx: Ctx = {
      ...ctx,
      cb: { outer },
      retTy,
      optionRet: false,
      tailTy: retTy,
      inLoop: false,
      brk: null,
      cont: null,
      ret: (_env, v) => v,
      fall: () => refuse('unsupported-syntax', `the ${what} callback can finish without returning a value`, fn),
    };
    let body: Expr;
    if (ts.isBlock(fn.body)) body = this.stmts(fn.body.statements, 0, env2, cctx);
    else body = this.expr(fn.body, env2, cctx);
    if (!tyEq(body.ty, retTy) && !(ts.isBlock(fn.body)))
      refuse('unsupported-syntax', what === 'filter' ? 'the filter callback must return a boolean (truthiness is outside subset v1)' : `the ${what} callback returns a value of an unexpected type`, fn.body);
    if (ts.isBlock(fn.body)) {
      walkExpr(body, (x) => {
        if (x.e === 'throw') refuse('unsupported-syntax', '`throw` inside a callback is outside subset v1', fn);
      });
    }
    return { e: 'lam', ty: retTy, params, body };
  }

  /**
   * Is the value of `e` a freshly allocated array (no other live reference to it)? Red-team round 1 (sortReduceAlias,
   * sortRecursionAlias, sortReduceInnerAlias): "any call result" is wrong, since `reduce` returns its accumulator or an
   * element and a self-call can return a parameter. Fresh: array literals; `slice/concat/map/filter/split` results
   * (each allocates a new array in JavaScript); `sort` of a fresh receiver (it returns the receiver); a conditional
   * with fresh branches; a self-call when every `return` of the function returns a fresh value (self-calls there are
   * assumed fresh: by induction over the terminating recursion). Anything else, including variables, is not.
   */
  private isFresh(e: ts.Expression, assumeSelf: boolean): boolean {
    const u = unparen(e);
    if (ts.isArrayLiteralExpression(u)) return true;
    if (ts.isConditionalExpression(u)) return this.isFresh(u.whenTrue, assumeSelf) && this.isFresh(u.whenFalse, assumeSelf);
    if (!ts.isCallExpression(u)) return false;
    if (ts.isIdentifier(u.expression) && this.isSelf(u.expression)) return assumeSelf || this.selfResultFresh();
    if (!ts.isPropertyAccessExpression(u.expression)) return false;
    const m = u.expression.name.text;
    if (['slice', 'concat', 'map', 'filter', 'split'].includes(m)) return true;
    if (m === 'sort') return this.isFresh(u.expression.expression, assumeSelf);
    return false;
  }

  private selfFresh: boolean | undefined;
  private selfResultFresh(): boolean {
    if (this.selfFresh !== undefined) return this.selfFresh;
    const body = this.fnNode.body;
    let ok = true;
    if (body && !ts.isBlock(body)) ok = this.isFresh(body, true);
    else if (body) {
      const visit = (n: ts.Node): void => {
        if (!ok || isFunctionLike(n)) return;
        if (ts.isReturnStatement(n)) ok = !!n.expression && this.isFresh(n.expression, true);
        else ts.forEachChild(n, visit);
      };
      ts.forEachChild(body, visit);
    }
    this.selfFresh = ok;
    return ok;
  }

  /**
   * `xs.sort(cmp)`. The receiver must be a fresh array (a call result or literal): sorting a variable in place would
   * mutate it. The comparator must be readable as "ascending/descending by key" (see NOTES.md):
   *   (a, b) => K(a) - K(b)          ascending, K numeric
   *   (a, b) => K(b) - K(a)          descending
   *   a three-way conditional over K(a) vs K(b) returning <0 / 0 / >0 literals (K numeric or string)
   * where K(x) is x, x.field, x[literal] or a chain of those. No comparator: string arrays only.
   */
  private sort(c: ts.CallExpression, recv: Expr, env: Env, ctx: Ctx): Expr {
    const at = recv.ty as Extract<Ty, { k: 'array' }>;
    const callee = c.expression as ts.PropertyAccessExpression;
    const r = unparen(callee.expression);
    if (!this.isFresh(r, false))
      refuse(
        'unsupported-syntax',
        'sort() mutates its receiver; the receiver must be an array no one else can see: an array literal or the result of slice/concat/map/filter/split ' +
          '(or of a recursive call whose every return is one of these). Sort a copy, e.g. xs.slice().sort(...)',
        c,
      );
    if (c.arguments.length > 1) refuse('unsupported-library', 'sort takes at most one argument', c);
    this.notes.add('sort: stable merge sort (List.mergeSort) ordered by the comparator\'s key; JS sort is stable since ES2019');
    const x: IrParam = { name: ctx.names.fresh('x'), ty: at.elem };
    if (c.arguments.length === 0) {
      if (at.elem.k !== 'string')
        refuse('unsupported-syntax', 'sort() without a comparator compares elements as strings; it is supported on string arrays only (pass (a, b) => a - b for numbers)', c);
      const spec: SortSpec = { key: { e: 'lam', ty: STR, params: [x], body: mkVar(x) }, keyTy: 'string', descending: false };
      return { e: 'prim', ty: at, op: 'sortBy', args: [recv], sort: spec };
    }
    const cmp = unparen(c.arguments[0]!);
    const fail = (why: string): never =>
      refuse('unsupported-syntax', `this comparator is not one the translator can read as a key order (${why}); supported: (a, b) => a.k - b.k, b.k - a.k, or a three-way a.k < b.k ? -1 : a.k > b.k ? 1 : 0`, cmp);
    if (!ts.isArrowFunction(cmp) && !ts.isFunctionExpression(cmp)) fail('not an inline arrow function');
    const fnc = cmp as ts.ArrowFunction | ts.FunctionExpression;
    // a `this` pseudo-parameter takes no argument position (see lambda()); never read it as `a` or `b`
    const thisP = fnc.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === 'this');
    if (thisP) refuse('this', 'a `this` parameter on the sort comparator is outside subset v1 (TypeScript erases it, so it takes no argument position)', thisP);
    if (fnc.parameters.length !== 2 || !fnc.parameters.every((p) => ts.isIdentifier(p.name) && !p.initializer && !p.dotDotDotToken)) fail('it must take two parameters');
    const pa = this.checker.getSymbolAtLocation(fnc.parameters[0]!.name)!;
    const pb = this.checker.getSymbolAtLocation(fnc.parameters[1]!.name)!;
    let bodyExpr: ts.Expression | undefined;
    if (ts.isBlock(fnc.body)) {
      const st = fnc.body.statements;
      if (st.length === 1 && ts.isReturnStatement(st[0]!) && st[0]!.expression) bodyExpr = st[0]!.expression;
    } else bodyExpr = fnc.body;
    if (!bodyExpr) fail('its body must be a single expression');
    // key path: [] = the element; string = field; number = tuple index
    type Path = Array<string | number>;
    const pathOf = (e: ts.Expression): { sym: ts.Symbol; path: Path } | null => {
      const u = unparen(e);
      if (ts.isIdentifier(u)) {
        const s = this.symOf(u);
        return s === pa || s === pb ? { sym: s, path: [] } : null;
      }
      if (ts.isPropertyAccessExpression(u) && !u.questionDotToken) {
        const inner = pathOf(u.expression);
        return inner ? { sym: inner.sym, path: [...inner.path, u.name.text] } : null;
      }
      if (ts.isElementAccessExpression(u) && ts.isNumericLiteral(unparen(u.argumentExpression))) {
        const inner = pathOf(u.expression);
        return inner ? { sym: inner.sym, path: [...inner.path, Number((unparen(u.argumentExpression) as ts.NumericLiteral).text)] } : null;
      }
      return null;
    };
    const samePath = (p: Path, q: Path): boolean => p.length === q.length && p.every((x, i) => x === q[i]);
    let keyPath: Path | null = null;
    const pairOf = (l: ts.Expression, r2: ts.Expression): 'ab' | 'ba' | null => {
      const L = pathOf(l);
      const R = pathOf(r2);
      if (!L || !R || L.sym === R.sym || !samePath(L.path, R.path)) return null;
      if (keyPath && !samePath(keyPath, L.path)) return null;
      keyPath = L.path;
      return L.sym === pa ? 'ab' : 'ba';
    };
    // Evaluate the comparator's sign symbolically for the three orders of key(a) vs key(b).
    type Ord = 'lt' | 'eq' | 'gt';
    // Any subtraction the sign evaluation reaches (top level or inside a conditional), not only a top-level one: on
    // string keys JS computes NaN, which sort treats as "equal" (red-team round 4, r4TsIgnoreSortStrMinus; the TS
    // error that also refuses it can be hidden, see translate.ts phase 4).
    let minusSeen = false;
    const evalSign = (e: ts.Expression, o: Ord): number | null => {
      const u = unparen(e);
      if (ts.isNumericLiteral(u)) return Math.sign(Number(u.text));
      if (ts.isPrefixUnaryExpression(u) && u.operator === K.MinusToken && ts.isNumericLiteral(unparen(u.operand))) return -Math.sign(Number((unparen(u.operand) as ts.NumericLiteral).text));
      if (ts.isBinaryExpression(u) && u.operatorToken.kind === K.MinusToken) {
        minusSeen = true;
        const pr = pairOf(u.left, u.right);
        if (!pr) return null;
        const s = o === 'lt' ? -1 : o === 'gt' ? 1 : 0;
        return pr === 'ab' ? s : -s;
      }
      if (ts.isConditionalExpression(u)) {
        const t = evalCond(u.condition, o);
        if (t === null) return null;
        return evalSign(t ? u.whenTrue : u.whenFalse, o);
      }
      return null;
    };
    const evalCond = (e: ts.Expression, o: Ord): boolean | null => {
      const u = unparen(e);
      if (!ts.isBinaryExpression(u)) return null;
      const pr = pairOf(u.left, u.right);
      if (!pr) return null;
      const ord: Ord = pr === 'ab' ? o : o === 'lt' ? 'gt' : o === 'gt' ? 'lt' : 'eq';
      switch (u.operatorToken.kind) {
        case K.LessThanToken:
          return ord === 'lt';
        case K.LessThanEqualsToken:
          return ord !== 'gt';
        case K.GreaterThanToken:
          return ord === 'gt';
        case K.GreaterThanEqualsToken:
          return ord !== 'lt';
        case K.EqualsEqualsEqualsToken:
          return ord === 'eq';
        case K.ExclamationEqualsEqualsToken:
          return ord !== 'eq';
        default:
          return null;
      }
    };
    const sLt = evalSign(bodyExpr!, 'lt');
    const sEq = evalSign(bodyExpr!, 'eq');
    const sGt = evalSign(bodyExpr!, 'gt');
    if (sLt === null || sEq === null || sGt === null || keyPath === null) fail('unrecognized form');
    if (sEq !== 0) fail('it does not return 0 for equal keys, so it is not a consistent comparator');
    let descending: boolean;
    if (sLt! < 0 && sGt! > 0) descending = false;
    else if (sLt! > 0 && sGt! < 0) descending = true;
    else fail('it does not order keys');
    // Build the key lambda from the path, and type it.
    let key: Expr = mkVar(x);
    for (const step of keyPath as unknown as Path) {
      if (typeof step === 'number') {
        if (key.ty.k !== 'tuple' || step < 0 || step >= key.ty.elems.length) fail('key index is not a tuple position');
        const tt = key.ty as Extract<Ty, { k: 'tuple' }>;
        key = { e: 'proj', ty: tt.elems[step]!, tuple: key, index: step };
      } else {
        if (key.ty.k !== 'record') fail('key field on a non-record');
        const f = (key.ty as Extract<Ty, { k: 'record' }>).fields.find((ff) => ff.name === step);
        if (!f) fail(`no field ${step}`);
        key = { e: 'field', ty: f!.ty, rec: key, name: step };
      }
    }
    if (key.ty.k !== 'int' && key.ty.k !== 'string') fail('the key is not a number or a string');
    if (minusSeen && key.ty.k !== 'int') fail('subtracting strings');
    this.comparators.add(fnc);
    const spec: SortSpec = { key: { e: 'lam', ty: key.ty, params: [x], body: key }, keyTy: key.ty.k as 'int' | 'string', descending: descending! };
    return { e: 'prim', ty: at, op: 'sortBy', args: [recv], sort: spec };
  }
}

function flip(op: ts.SyntaxKind): ts.SyntaxKind {
  switch (op) {
    case K.LessThanToken:
      return K.GreaterThanToken;
    case K.LessThanEqualsToken:
      return K.GreaterThanEqualsToken;
    case K.GreaterThanToken:
      return K.LessThanToken;
    case K.GreaterThanEqualsToken:
      return K.LessThanEqualsToken;
    default:
      return op;
  }
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? `${v}n` : v;
}

function childrenOf(e: Expr): Expr[] {
  return directChildren(e);
}

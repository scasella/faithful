/**
 * `instrumentedTs`: the original function with every operation in `CHECKED_OPS` (ir.ts) routed through a check on the
 * runtime object `__faithful`. The checks are the TypeScript twin of the Lean `<fn>_chk`: same operations, same
 * evaluation order, same predicate. Each helper computes exactly the JavaScript operation it replaces, so behavior is
 * unchanged whenever the checks pass. WHICH nodes are checked is decided by the lowering, from the IR the twin is
 * printed from (`LowerResult.checked`); this module only rewrites them. Self-calls go through `rec`, the
 * recursion-depth check (`MAX_RECURSION_DEPTH`).
 *
 * Calling convention (consumed by the engine):
 *  - `instrumentedTs` is TypeScript source declaring the function (no `export`), preceded by the module-level literal
 *    constants it reads. It refers to one free identifier, `__faithful` (see `FAITHFUL_TS_RUNTIME`). When the file
 *    itself uses the identifier `__faithful`, the first line is `const __faithful_rt = __faithful;` (a name fresh for
 *    the file) and the helpers are called on that alias, so no user binding can shadow the runtime.
 *  - `buildInstrumentedRunner(t)` returns JavaScript source of an expression that evaluates to
 *    `(args: Val[]) => Outcome`. It bundles the runtime, the transpiled function and the outcome mapping:
 *      ok value -> {tag:'ok', value} (undefined/null -> null, via a JSON round trip),
 *      a check failure -> {tag:'range-violation', detail},
 *      the function's own literal `throw` -> {tag:'throw', message},
 *      anything else (stack overflow, TypeError, ...) -> {tag:'fault', detail}.
 *    Arguments are deep-copied (JSON) before the call. Evaluate it with `new Function('return ' + src)()` or `vm`.
 *    The function's source is evaluated in a nested scope of its own, so none of its names can shadow the runner's or
 *    the runtime's bindings (red-team round 3).
 *  - Sort comparators recognized as key orders are left uninstrumented: only the comparator's sign matters, and the
 *    sign of `a - b` is exact for integers within ±2^53 even when the difference itself is not.
 */
import ts from 'typescript';
import type { Translation } from './contracts.js';
import { MAX_RECURSION_DEPTH, MAX_STRING_LENGTH } from './ir.js';

/**
 * JavaScript source of the `__faithful` runtime object. Bounds are inclusive ±2^53 and exact (BigInt at the edge).
 * `depth` is the number of live activations of the translated function (1 inside a top-level call); `rec` refuses a
 * self-call when it is already MAX_DEPTH, exactly like the Lean twin's `τd < D` check, and restores it on any exit.
 */
export const FAITHFUL_TS_RUNTIME = String.raw`const __faithful = (() => {
  const MAX = 9007199254740992;
  const MAX_DEPTH = ${MAX_RECURSION_DEPTH};
  const MAX_STR = ${MAX_STRING_LENGTH};
  let depth = 1;
  class RangeViolation { constructor(detail) { this.detail = detail; } }
  class UserThrow { constructor(message) { this.message = message; } }
  const fail = (kind, site) => { throw new RangeViolation(kind + ' check failed at ' + site); };
  const exact = (r, big, site) => {
    if (Math.abs(r) < MAX) return r;
    if (Math.abs(r) === MAX && BigInt(r) === big) return r;
    return fail('range', site);
  };
  return {
    RangeViolation, UserThrow,
    add(a, b, site) { const r = a + b; return Math.abs(r) < MAX ? r : exact(r, BigInt(a) + BigInt(b), site); },
    sub(a, b, site) { const r = a - b; return Math.abs(r) < MAX ? r : exact(r, BigInt(a) - BigInt(b), site); },
    mul(a, b, site) { const r = a * b; return Math.abs(r) < MAX ? r : exact(r, BigInt(a) * BigInt(b), site); },
    mod(a, b, site) { if (b === 0) fail('nonzero', site); return a % b; },
    floorDiv(a, b, site) { if (b === 0) fail('nonzero', site); return Math.floor(a / b); },
    ceilDiv(a, b, site) { if (b === 0) fail('nonzero', site); return Math.ceil(a / b); },
    at(xs, i, site) { if (!(i >= 0 && i < xs.length)) fail('bounds', site); return xs[i]; },
    charCodeAt(s, i, site) { if (!(i >= 0 && i < s.length)) fail('bounds', site); return s.charCodeAt(i); },
    lower(s, site) { if (/[^\x00-\x7f]/.test(s)) fail('ascii', site); return s.toLowerCase(); },
    upper(s, site) { if (/[^\x00-\x7f]/.test(s)) fail('ascii', site); return s.toUpperCase(); },
    // String length (MAX_STR): checked BEFORE concatenating, so V8's own RangeError (2^29 - 24 units) is never reached.
    // Operands are numbers, booleans or strings; String(x) is exactly the ToString that '+' and templates apply.
    concat(a, b, site) { const x = String(a), y = String(b); if (x.length + y.length > MAX_STR) fail('length', site); return x + y; },
    template(site, ...parts) {
      const ss = parts.map((p) => String(p));
      let n = 0;
      for (const s of ss) n += s.length;
      if (n > MAX_STR) fail('length', site);
      let r = '';
      for (const s of ss) r += s;
      return r;
    },
    join(site, xs, ...rest) {
      const sep = rest.length > 0 ? String(rest[0]) : ',';
      let n = xs.length > 1 ? (xs.length - 1) * sep.length : 0;
      for (const x of xs) n += String(x).length;
      if (n > MAX_STR) fail('length', site);
      return xs.join(sep);
    },
    rec(site, fn, ...args) {
      if (!(depth < MAX_DEPTH)) fail('depth', site);
      depth++;
      try { return fn(...args); } finally { depth--; }
    },
    userThrow(message) { return new UserThrow(message); },
  };
})();`;

const K = ts.SyntaxKind;

function unparen(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

export interface InstrumentInput {
  sf: ts.SourceFile;
  /** The function declaration, or the variable statement of `export const f = (...) => ...`. */
  fnStatement: ts.FunctionDeclaration | ts.VariableStatement;
  moduleConsts: ts.VariableStatement[];
  comparators: Set<ts.Node>;
  /**
   * The nodes to route through a check and the helper for each, computed by the lowering from the IR the Lean twin is
   * printed from (`LowerResult.checked`). The instrumentation makes no decisions of its own about which operations are
   * checked, so the two sides cannot disagree on what counts as a number, a string or an index.
   */
  checked: Map<ts.Node, string>;
}

/** Every identifier text in the file (for choosing a runtime alias that no user binding can shadow). */
const identifierCache = new WeakMap<ts.SourceFile, Set<string>>();
function identifierTexts(sf: ts.SourceFile): Set<string> {
  // asked once per translated function, and a walk of the whole file each time made translating a file's N functions quadratic
  const hit = identifierCache.get(sf);
  if (hit) return hit;
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  identifierCache.set(sf, out);
  return out;
}

export function instrument(inp: InstrumentInput): string {
  const { sf } = inp;
  const f = ts.factory;
  // Hygiene (red-team round 1, faithfulParam/faithfulLocal): the helpers are reached through `__faithful` unless the
  // file itself uses that identifier (a parameter or local named `__faithful` would shadow the runtime); then through
  // a fresh alias bound at the top of instrumentedTs, where only the runtime's `__faithful` is in scope.
  const idents = identifierTexts(sf);
  let rt = '__faithful';
  if (idents.has(rt)) {
    rt = '__faithful_rt';
    for (let i = 2; idents.has(rt); i++) rt = `__faithful_rt${i}`;
  }
  const site = (n: ts.Node): ts.StringLiteral => {
    const lc = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    const text = n.getText(sf).replace(/\s+/g, ' ');
    return f.createStringLiteral(`line ${lc.line + 1}: ${text.length > 60 ? text.slice(0, 57) + '...' : text}`);
  };
  const helper = (name: string, args: ts.Expression[]): ts.CallExpression =>
    f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier(rt), name), undefined, args);
  const internal = (node: ts.Node, h: string): never => {
    throw new Error(`internal: instrumentation of ${ts.SyntaxKind[node.kind]} as ${h} (${node.getText(sf).slice(0, 60)})`);
  };
  const BIN = new Set(['add', 'sub', 'mul', 'mod', 'concat']);

  const transformer: ts.TransformerFactory<ts.Node> = (context) => {
    const visit = (node: ts.Node): ts.Node => {
      if (inp.comparators.has(node)) return node;
      const h = inp.checked.get(node);
      if (h !== undefined) {
        // children are visited after the decision on the original node
        const v = (e: ts.Expression): ts.Expression => ts.visitNode(e, visit) as ts.Expression;
        if (ts.isBinaryExpression(node)) {
          if (!BIN.has(h)) internal(node, h);
          const op = node.operatorToken.kind;
          const l = v(node.left);
          const r = v(node.right);
          if (op >= K.FirstAssignment && op <= K.LastAssignment) return f.createAssignment(l, helper(h, [l, r, site(node)]));
          return helper(h, [l, r, site(node)]);
        }
        if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
          if (!(h === 'add' && node.operator === K.PlusPlusToken) && !(h === 'sub' && node.operator === K.MinusMinusToken)) internal(node, h);
          const o = v(node.operand);
          return f.createAssignment(o, helper(h, [o, f.createNumericLiteral(1), site(node)]));
        }
        if (ts.isTemplateExpression(node)) {
          // all substitutions are evaluated (in order) as arguments, then one length check on the whole result
          if (h !== 'concat') internal(node, h);
          const parts: ts.Expression[] = [];
          if (node.head.text) parts.push(f.createStringLiteral(node.head.text));
          for (const sp of node.templateSpans) {
            parts.push(v(sp.expression));
            if (sp.literal.text) parts.push(f.createStringLiteral(sp.literal.text));
          }
          return helper('template', [site(node), ...parts]);
        }
        if (ts.isElementAccessExpression(node)) {
          if (h !== 'at') internal(node, h);
          return helper('at', [v(node.expression), v(node.argumentExpression), site(node)]);
        }
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          if (h === 'rec') {
            // self-call: arguments first (JavaScript order), then the depth check, then the call
            return helper('rec', [site(node), v(callee), ...node.arguments.map(v)]);
          }
          if (!ts.isPropertyAccessExpression(callee)) internal(node, h);
          const pa = callee as ts.PropertyAccessExpression;
          if (h === 'floorDiv' || h === 'ceilDiv') {
            const a = unparen(node.arguments[0]!);
            if (!ts.isBinaryExpression(a) || a.operatorToken.kind !== K.SlashToken) internal(node, h);
            const d = a as ts.BinaryExpression;
            return helper(h, [v(d.left), v(d.right), site(node)]);
          }
          if (h === 'charCodeAt') return helper('charCodeAt', [v(pa.expression), v(node.arguments[0]!), site(node)]);
          if (h === 'lower' || h === 'upper') return helper(h, [v(pa.expression), site(node)]);
          if (h === 'join') return helper('join', [site(node), v(pa.expression), ...node.arguments.map(v)]);
        }
        internal(node, h);
      }
      if (ts.isThrowStatement(node)) {
        const ex = unparen(node.expression);
        let msg: string | undefined;
        if (ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex)) msg = ex.text;
        else if ((ts.isNewExpression(ex) || ts.isCallExpression(ex)) && ex.arguments && ex.arguments[0]) {
          const a0 = unparen(ex.arguments[0]);
          if (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) msg = a0.text;
        }
        if (msg !== undefined) return f.createThrowStatement(helper('userThrow', [f.createStringLiteral(msg)]));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root) => ts.visitNode(root, visit) as ts.Node;
  };

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
  const parts: string[] = [];
  if (rt !== '__faithful') parts.push(`const ${rt} = __faithful;`);
  for (const c of inp.moduleConsts) parts.push(printer.printNode(ts.EmitHint.Unspecified, stripExport(c), sf));
  const res = ts.transform(inp.fnStatement as ts.Node, [transformer]);
  try {
    parts.push(printer.printNode(ts.EmitHint.Unspecified, stripExport(res.transformed[0] as ts.Statement), sf));
  } finally {
    res.dispose();
  }
  return parts.join('\n') + '\n';
}

function stripExport(s: ts.Statement): ts.Statement {
  const f = ts.factory;
  const keep = (mods: ts.NodeArray<ts.ModifierLike> | undefined): ts.ModifierLike[] | undefined =>
    mods?.filter((m) => m.kind !== K.ExportKeyword && m.kind !== K.DefaultKeyword);
  if (ts.isFunctionDeclaration(s))
    return f.updateFunctionDeclaration(s, keep(s.modifiers), s.asteriskToken, s.name, s.typeParameters, s.parameters, s.type, s.body);
  if (ts.isVariableStatement(s)) return f.updateVariableStatement(s, keep(s.modifiers), s.declarationList);
  return s;
}

/** JavaScript source of an expression evaluating to `(args: Val[]) => Outcome`; see the module comment. */
export function buildInstrumentedRunner(t: Pick<Translation, 'fnName' | 'instrumentedTs'>): string {
  const js = ts.transpileModule(t.instrumentedTs, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: true },
    reportDiagnostics: false,
  }).outputText.replace(/^export \{\};?\s*$/m, '');
  // Hygiene (red-team round 3, r3RunnerNameRun/Value/Input): the user's declarations live in their own function scope
  // (the inner arrow), and the runner reaches the user function only through `__faithful_entry`, bound in the OUTER
  // scope. So no user name (`run`, `value`, `input`, `Math`, `BigInt`, `JSON`, ...) can capture a binding of the runner
  // or of the runtime, whose free identifiers all resolve in the outer scope. `${fnName}` is read only inside the inner
  // scope, where it is the user's own function.
  return `(() => {
"use strict";
${FAITHFUL_TS_RUNTIME}
const __faithful_entry = (() => {
${js}
return ${t.fnName};
})();
return function (args) {
  let input;
  try { input = JSON.parse(JSON.stringify(args)); } catch (e) { return { tag: 'fault', detail: 'arguments are not JSON' }; }
  try {
    const value = __faithful_entry(...input);
    return { tag: 'ok', value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
  } catch (e) {
    if (e instanceof __faithful.RangeViolation) return { tag: 'range-violation', detail: e.detail };
    if (e instanceof __faithful.UserThrow) return { tag: 'throw', message: e.message };
    return { tag: 'fault', detail: String(e && e.message !== undefined ? e.message : e) };
  }
};
})()`;
}

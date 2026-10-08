/**
 * Extract one function as a self-contained unit for the Tested tier: the target `function` declaration plus only the
 * module-level declarations it needs, transitively, in their original order. The unit is what `prepareSource` /
 * `Sandbox.load` receive as "the original" (docs/SECURITY.md, "Extracted units"), so an unrelated import or a top-level
 * side effect elsewhere in the file no longer blocks a function that does not use it.
 *
 * RULES (also in docs/SECURITY.md):
 *  1. Target: a top-level `function` declaration named `fnName` with a body (with its JSDoc). This is the same finder
 *     the rest of the Tested path uses (`inferSignature`, `mutationCheck`, the compile gate, `findFunction` in the CLI),
 *     so `const f = () => ...` is refused with a reason rather than half-supported. An OVERLOADED function is refused
 *     with `sameForWholeFile` (the patch splice and the input generator handle one declaration). When the declaration
 *     is not exported, the unit exports it (the compile gate looks for an exported function).
 *  2. Closure: every identifier in an included declaration (bodies, initializers, class members, enum initializers,
 *     type annotations) is resolved with the TypeScript checker over this one in-memory file (no lib, no module
 *     resolution: only the binder's scopes matter). A reference whose symbol is a module-level binding pulls in the
 *     WHOLE statement that declares it (a multi-declarator `const a = 1, b = 2` or a destructuring `const { a, b } = cfg`
 *     is kept whole). Parameters, locals, properties and anything shadowing a module name resolve to their own symbols,
 *     so they never pull a declaration in. The checker is used instead of a hand-written scope walk because hoisting,
 *     block/catch/loop scopes, destructuring, shorthand properties (`{ live }`) and `typeof X` in types all come for
 *     free from the binder; a hand-written walk tends to get one of them wrong.
 *  3. Refused (ok: false, with a position): the closure references an imported binding (value OR type: a dropped
 *     import would leave the name unresolved for the compile gate and the input generator), a namespace, an
 *     `import x = N.y` alias, or a value only `declare`d in this file (its value comes from elsewhere); an included
 *     declaration uses dynamic `import()`, `import.meta`, or top-level `await`; an included declaration uses an
 *     ambient global the sandbox traps (`console`, `process`, `window`, `globalThis`, timers, ...) in code that runs
 *     when the file loads; an included declaration calls `eval(...)` directly (it sees every name of the file,
 *     including the ones the unit leaves out); no function declaration named `fnName` exists.
 *  4. Everything else at the top level is DROPPED: imports (type-only or not), re-exports, `export default <expr>`, other
 *     functions and classes, and top-level statements, including ones that would throw or touch ambient globals.
 *  5. Soundness guard: dropping a statement must not change what the function sees. Every dropped top-level statement
 *     but a function declaration is load-time code AS A WHOLE (IIFEs, callbacks, object getters, computed keys,
 *     decorators, `extends`), except what `notAtLoad` names (a function directly initializing a top-level variable; the
 *     member bodies and instance field initializers of a class that runs nothing at load); a dropped declaration that
 *     load-time code references is checked in full. Refused: changing, calling a method of, or passing on an included
 *     binding (tagged-template substitutions and the left of `instanceof` pass it on); reading one that is not plain
 *     data (a getter or `valueOf` could run); calling or passing on an included function when the closure holds mutable
 *     state (an included function used as anything but a PLAIN callee counts: `new h()` reads `h.prototype` and
 *     `h.call(...)` looks `call` up on `h`); running or passing on an included function at all also scans that function's
 *     body like load-time code (`function patch() { Array.prototype.x = ... } patch();`); changing, calling a method of, or
 *     passing on a built-in every module shares (`Array.prototype.x = ...`, `Array.prototype.push(1)`, `globalThis.x =
 *     ...`, `Object.assign(Math, ...)`, `Object.getPrototypeOf([]).x = ...`; `Object.prototype.hasOwnProperty.call(o, k)`
 *     only looks a method up and is allowed); reaching code-from-a-string or a prototype without naming it
 *     (`Array.constructor(...)`, `globalThis.eval(...)`, a `getPrototypeOf` result that is kept, a destructuring pattern
 *     that picks `constructor`, `__proto__`, `prototype`, `eval` or `Function`); `eval` or `Function`. A const bound to a
 *     primitive literal can never change and is exempt. `arguments` is the call's own object, but its `__proto__` is the
 *     shared `Object.prototype`, so it is checked like a binding of the file (`arguments[0] = 1` is allowed,
 *     `arguments.__proto__.k = 1` is not). A `var` nested in another statement of the file (`if (c) { var x = 1 }`,
 *     `for (var x of xs)`, `try { var x } catch {}`) declares a MODULE-level variable that dropping the statement would
 *     change or remove, so a function that reads a name declared that way is refused (rule 3's closure walk).
 *     Two things are NOT load-time code that must be checked: an alias statement
 *     (`const RealFunction = Function;`, `const gp = Object.getPrototypeOf;`; see `builtinAliases`, every reference to the
 *     alias is checked instead) and a reference that only STORES a dropped declaration in the default export (see
 *     `storedInDefaultExport`).
 *  6. Disclosure: when a part rule 5 does not treat as load-time code can change included mutable state, extraction
 *     succeeds with a caveat: the comparison saw only the starting value of that state (the whole-file path saw the
 *     same). The caveat is recorded in `tested.started`, the provenance and VERIFY.md.
 *
 * Honest limits: the comparison is with the function as it behaves when its file is evaluated by itself. Code in
 * OTHER modules (including a module this file imports, which may import it back and change its exported objects) is
 * not seen, exactly as the whole-file path never saw it. The guard is syntactic and over-approximates (the whole-file
 * fallback then applies). Reproductions of every refused shape: extract.test.ts, "soundness guard".
 */
import ts from 'typescript';
import { TRAPPED } from './mask.js';

export type IncludedKind = 'function' | 'const' | 'let' | 'var' | 'class' | 'type' | 'interface' | 'enum';

export interface IncludedDecl {
  kind: IncludedKind;
  name: string;
  /** 1-based line of the declaration in the original file. */
  line: number;
}

export type ExtractResult =
  | {
      ok: true;
      unit: string;
      included: IncludedDecl[];
      /** Plain-words notes about what was left out (includes every `caveats` entry). */
      notes: string[];
      /**
       * Disclosures that qualify the Tested claim: included state that other code in the file (function or method
       * bodies that do not run when the file loads) can change. The comparison saw only its starting value.
       */
      caveats: string[];
      /** `lineMap[i]` is the 1-based line in the original file of line `i + 1` of `unit` (for reporting positions). */
      lineMap: number[];
    }
  | {
      ok: false;
      reason: string;
      line?: number;
      column?: number;
      /** The refusal applies to running the whole file too (an overloaded target): no whole-file fallback. */
      sameForWholeFile?: boolean;
    };

const FILE = '/faithful/extract.ts';
const OPTIONS: ts.CompilerOptions = {
  noLib: true,
  noResolve: true,
  types: [],
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  noEmit: true,
  allowJs: false,
};
const TRAPPED_SET: ReadonlySet<string> = new Set<string>(TRAPPED);

interface ImportInfo {
  module: string;
  typeOnly: boolean;
}

interface Analysis {
  sf: ts.SourceFile;
  checker: ts.TypeChecker;
  /** Module-level binding symbol -> the top-level statements declaring it. */
  decls: Map<ts.Symbol, ts.Statement[]>;
  imports: Map<ts.Symbol, ImportInfo>;
  /** Statement -> the names it declares. */
  names: Map<ts.Statement, ts.Identifier[]>;
  /**
   * `var` declarations at module scope that sit inside another statement (`if (c) { var x = 1 }`, `for (var x of xs)`,
   * `try { var x } catch {}`): they declare (or re-declare) a MODULE-level variable that `decls` does not bind, because
   * only top-level statements are bound there. Declaration node -> its names.
   */
  nestedVars: Map<ts.VariableDeclaration, string[]>;
  /** Every name in `nestedVars`. */
  nestedVarNames: Set<string>;
  parseError: { message: string; pos: number } | null;
}

const cache = new Map<string, Analysis>();
const CACHE_MAX = 16;

function analyse(source: string): Analysis {
  const hit = cache.get(source);
  if (hit) {
    cache.delete(source);
    cache.set(source, hit);
    return hit;
  }
  const sf0 = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const host: ts.CompilerHost = {
    getSourceFile: (f) => (f === FILE ? sf0 : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/faithful',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === FILE,
    readFile: (f) => (f === FILE ? source : undefined),
  };
  const program = ts.createProgram({ rootNames: [FILE], options: OPTIONS, host });
  const sf = program.getSourceFile(FILE)!;
  const checker = program.getTypeChecker();
  const syntax = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  const pe = syntax[0];
  const a: Analysis = {
    sf,
    checker,
    decls: new Map(),
    imports: new Map(),
    names: new Map(),
    nestedVars: new Map(),
    nestedVarNames: new Set(),
    parseError: pe ? { message: ts.flattenDiagnosticMessageText(pe.messageText, ' '), pos: pe.start ?? 0 } : null,
  };
  const bind = (st: ts.Statement, id: ts.Identifier | undefined): void => {
    if (!id) return;
    const list = a.names.get(st) ?? [];
    list.push(id);
    a.names.set(st, list);
    const sym = checker.getSymbolAtLocation(id);
    if (!sym) return;
    const sts = a.decls.get(sym) ?? [];
    if (!sts.includes(st)) sts.push(st);
    a.decls.set(sym, sts);
  };
  const bindPattern = (st: ts.Statement, n: ts.BindingName): void => {
    if (ts.isIdentifier(n)) return bind(st, n);
    for (const el of n.elements) if (!ts.isOmittedExpression(el)) bindPattern(st, el.name);
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      if (!clause) continue;
      const module = ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : st.moduleSpecifier.getText(sf);
      const add = (id: ts.Identifier, typeOnly: boolean): void => {
        const sym = checker.getSymbolAtLocation(id);
        if (sym) a.imports.set(sym, { module, typeOnly });
      };
      if (clause.name) add(clause.name, clause.isTypeOnly);
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) add(nb.name, clause.isTypeOnly);
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) add(el.name, clause.isTypeOnly || el.isTypeOnly);
    } else if (ts.isImportEqualsDeclaration(st)) {
      const sym = checker.getSymbolAtLocation(st.name);
      const ref = st.moduleReference;
      const module = ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression) ? ref.expression.text : ref.getText(sf);
      if (sym) a.imports.set(sym, { module, typeOnly: st.isTypeOnly });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) bindPattern(st, d.name);
    } else if (
      ts.isFunctionDeclaration(st) ||
      ts.isClassDeclaration(st) ||
      ts.isEnumDeclaration(st) ||
      ts.isInterfaceDeclaration(st) ||
      ts.isTypeAliasDeclaration(st)
    ) {
      bind(st, st.name);
    } else if (ts.isModuleDeclaration(st) && ts.isIdentifier(st.name)) {
      bind(st, st.name);
    }
  }
  // module-scope `var`s nested in other statements (hoisted to the module): not inside a function, a class static block or a namespace
  const nest = (n: ts.Node): void => {
    if (isFunctionBoundary(n) || ts.isClassStaticBlockDeclaration(n) || ts.isModuleDeclaration(n)) return;
    if (ts.isVariableDeclarationList(n) && !(n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) && !(ts.isVariableStatement(n.parent) && n.parent.parent === sf)) {
      for (const d of n.declarations) {
        const names: string[] = [];
        const collect = (b: ts.BindingName): void => {
          if (ts.isIdentifier(b)) names.push(b.text);
          else for (const el of b.elements) if (!ts.isOmittedExpression(el)) collect(el.name);
        };
        collect(d.name);
        a.nestedVars.set(d, names);
        for (const nm of names) a.nestedVarNames.add(nm);
      }
    }
    ts.forEachChild(n, nest);
  };
  for (const st of sf.statements) nest(st);
  cache.set(source, a);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return a;
}

function lineCol(sf: ts.SourceFile, pos: number): { line: number; column: number } {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, column: lc.character + 1 };
}

/**
 * Is `sym` declared in this file? The checker supplies symbols of its own even with `noLib` (`globalThis`, `undefined`,
 * `arguments`): they have no declaration here and are globals as far as the guard is concerned (a root cause of
 * `globalThis.x = ...` slipping through while `window.x = ...` was refused).
 */
const declaredHere = (sym: ts.Symbol | undefined): sym is ts.Symbol => !!sym && (sym.declarations?.length ?? 0) > 0;

const hasModifier = (n: ts.Node, k: ts.SyntaxKind): boolean => !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === k));

function isFunctionBoundary(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  );
}

/** Does `n` run when the file loads (not inside a function body or an instance field initializer)? */
function runsAtLoad(n: ts.Node, stop: ts.Node): boolean {
  for (let c: ts.Node = n; c !== stop && c.parent; c = c.parent) {
    if (isFunctionBoundary(c)) return false;
    if (ts.isPropertyDeclaration(c) && ts.isClassLike(c.parent) && !hasModifier(c, ts.SyntaxKind.StaticKeyword)) return false;
  }
  return !(stop !== n && isFunctionBoundary(stop));
}

/** Is `id` in a type position (erased at run time)? */
function inTypePosition(id: ts.Node): boolean {
  for (let c: ts.Node = id; c.parent; c = c.parent) {
    const p = c.parent;
    if (ts.isHeritageClause(p)) return p.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(p.parent);
    if (ts.isTypeNode(c) && !ts.isExpressionWithTypeArguments(c)) return true;
    if (ts.isInterfaceDeclaration(c) || ts.isTypeAliasDeclaration(c)) return true;
    if (ts.isStatement(c) || ts.isSourceFile(c)) return false;
  }
  return false;
}

/** Is identifier `id` a reference to a binding (rather than a property name, a declaration name, a label ...)? */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if ((ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) && p.label === id) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  if (ts.isShorthandPropertyAssignment(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if (ts.isMetaProperty(p)) return false;
  if (ts.isJsxAttribute(p)) return false;
  if (isDeclLike(p) && (p as { name?: ts.Node }).name === id) return false;
  return true;
}

function isDeclLike(p: ts.Node): boolean {
  return (
    ts.isVariableDeclaration(p) ||
    ts.isParameter(p) ||
    ts.isBindingElement(p) ||
    ts.isFunctionDeclaration(p) ||
    ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) ||
    ts.isClassExpression(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) ||
    ts.isEnumDeclaration(p) ||
    ts.isEnumMember(p) ||
    ts.isInterfaceDeclaration(p) ||
    ts.isTypeAliasDeclaration(p) ||
    ts.isTypeParameterDeclaration(p) ||
    ts.isModuleDeclaration(p)
  );
}

function symbolOf(checker: ts.TypeChecker, id: ts.Identifier): ts.Symbol | undefined {
  if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) return checker.getShorthandAssignmentValueSymbol(id.parent) ?? undefined;
  return checker.getSymbolAtLocation(id);
}

function kindOf(st: ts.Statement): IncludedKind {
  if (ts.isFunctionDeclaration(st)) return 'function';
  if (ts.isClassDeclaration(st)) return 'class';
  if (ts.isEnumDeclaration(st)) return 'enum';
  if (ts.isInterfaceDeclaration(st)) return 'interface';
  if (ts.isTypeAliasDeclaration(st)) return 'type';
  if (ts.isVariableStatement(st)) {
    const f = st.declarationList.flags;
    return f & ts.NodeFlags.Const ? 'const' : f & ts.NodeFlags.Let ? 'let' : 'var';
  }
  return 'const';
}

function isPrimitiveLiteral(e: ts.Expression | undefined): boolean {
  if (!e) return false;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  if (ts.isPrefixUnaryExpression(e) && (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken)) return isPrimitiveLiteral(e.operand);
  return (
    ts.isNumericLiteral(e) ||
    ts.isStringLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  );
}

function isFunctionInit(e: ts.Expression | undefined): boolean {
  if (!e) return false;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return ts.isArrowFunction(e) || ts.isFunctionExpression(e);
}

/** A `const` statement whose every declarator is a plain name bound to a primitive literal: it can never change. */
function isFrozenConst(st: ts.Statement): boolean {
  return (
    ts.isVariableStatement(st) &&
    !!(st.declarationList.flags & ts.NodeFlags.Const) &&
    st.declarationList.declarations.every((d) => ts.isIdentifier(d.name) && isPrimitiveLiteral(d.initializer))
  );
}

/** Statement that holds state a function could change (see rule 5). */
function holdsMutableState(st: ts.Statement): boolean {
  if (ts.isClassDeclaration(st)) return true;
  if (!ts.isVariableStatement(st)) return false;
  if (!(st.declarationList.flags & ts.NodeFlags.Const)) return true;
  return !st.declarationList.declarations.every((d) => ts.isIdentifier(d.name) && (isPrimitiveLiteral(d.initializer) || isFunctionInit(d.initializer)));
}

const ASSIGNMENT_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);
/** Operators whose result is a new primitive (so the operand does not escape through them). */
const READ_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);

type Use = 'read' | 'changes' | 'calls' | 'passes';

/** How a reference to a binding in dropped load-time code uses it (rule 5). */
function useOf(id: ts.Node): Use {
  if (ts.isIdentifier(id) && ts.isShorthandPropertyAssignment(id.parent)) {
    // `{ x }` in an object literal passes x on; in a destructuring assignment target it assigns x
    return isAssignmentTarget(id.parent.parent) ? 'changes' : 'passes';
  }
  let n: ts.Node = id;
  for (;;) {
    const p: ts.Node = n.parent;
    if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n) n = p;
    else if (ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p)) n = p;
    else break;
  }
  const p = n.parent;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === n) return 'calls';
  if (ts.isTaggedTemplateExpression(p) && p.tag === n) return 'calls';
  if (ts.isBinaryExpression(p) && ASSIGNMENT_OPS.has(p.operatorToken.kind)) {
    if (p.left === n) return 'changes';
    return 'passes';
  }
  if (isAssignmentTarget(n)) return 'changes';
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return 'changes';
  if (ts.isDeleteExpression(p)) return 'changes';
  if ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.initializer === n) return 'changes';
  // `xs.length` / `m.size`: a number, read from the binding; nothing escapes
  if (n !== id && ts.isPropertyAccessExpression(n) && (n.name.text === 'length' || n.name.text === 'size') && n.expression === id) return 'read';
  // `x instanceof C` hands x to C[Symbol.hasInstance] (user code)
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && p.left === n) return 'passes';
  if (ts.isBinaryExpression(p) && READ_OPS.has(p.operatorToken.kind)) return 'read';
  if (ts.isPrefixUnaryExpression(p) || ts.isTypeOfExpression(p) || ts.isVoidExpression(p)) return 'read';
  // a substitution of a TAGGED template is an argument of the tag function
  if (ts.isTemplateSpan(p)) return ts.isTaggedTemplateExpression(p.parent.parent) ? 'passes' : 'read';
  if (ts.isExpressionStatement(p)) return 'read';
  if ((ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isSwitchStatement(p)) && p.expression === n) return 'read';
  if (ts.isForStatement(p) && p.condition === n) return 'read';
  if (ts.isConditionalExpression(p) && p.condition === n) return 'read';
  if (ts.isCaseClause(p) && p.expression === n) return 'read';
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return 'read';
  if (ts.isComputedPropertyName(p)) return 'read';
  return 'passes';
}

/** Strip parentheses and type-only wrappers (`as`, `satisfies`, `!`, `<T>x`). */
function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

/** The outermost expression that is `n` seen through wrappers (`(n as any)!`). */
function wrapped(n: ts.Node): ts.Node {
  let c = n;
  while (c.parent && (ts.isParenthesizedExpression(c.parent) || ts.isAsExpression(c.parent) || ts.isSatisfiesExpression(c.parent) || ts.isNonNullExpression(c.parent) || ts.isTypeAssertionExpression(c.parent))) c = c.parent;
  return c;
}

/**
 * Is this reference to a function only CALLED PLAINLY (`h(x)`, `` h`...` ``)? Any other use (`new h()`, `h.call(...)`,
 * `h.k`, `h['k']`, `const a = h`, `xs.map(h)`) treats the function as an object, which can carry state (rule 5).
 */
function onlyCalled(id: ts.Identifier): boolean {
  const w = wrapped(id);
  const p = w.parent;
  // `new h()` reads `h.prototype`, and `h.call(...)` / `.apply` / `.bind` look the method up on `h` itself: both use the function
  // as an object (a property attached to it, or a changed `h.prototype`, is state the call reads). Only a plain call does not.
  if (ts.isCallExpression(p) && p.expression === w) return true;
  if (ts.isTaggedTemplateExpression(p) && p.tag === w) return true;
  return false;
}

/**
 * Plain data: a value whose reads can never run code written in the file (no methods, getters, `valueOf`, class
 * instances): literals, and arrays / object literals of plain data with plain keys, or a built-in collection
 * (`new Map()`, `new Set(...)`, typed arrays). Reading such a binding from dropped load-time code is a pure read.
 */
const PLAIN_CTORS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array']);
function isPlainExpr(e: ts.Expression | undefined, checker: ts.TypeChecker): boolean {
  if (!e) return true;
  e = unwrap(e);
  if (isPrimitiveLiteral(e)) return true;
  if (ts.isIdentifier(e) && e.text === 'undefined') return true;
  if (ts.isArrayLiteralExpression(e)) return e.elements.every((x) => !ts.isSpreadElement(x) && (ts.isOmittedExpression(x) || isPlainExpr(x, checker)));
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.every((pr) => ts.isPropertyAssignment(pr) && (ts.isIdentifier(pr.name) || ts.isStringLiteral(pr.name) || ts.isNumericLiteral(pr.name)) && pr.name.getText() !== '__proto__' && isPlainExpr(pr.initializer, checker));
  }
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && PLAIN_CTORS.has(e.expression.text) && !checker.getSymbolAtLocation(e.expression)) {
    return (e.arguments ?? []).every((x) => !ts.isSpreadElement(x) && isPlainExpr(x, checker));
  }
  return false;
}
function isPlainData(st: ts.Statement, checker: ts.TypeChecker): boolean {
  if (ts.isEnumDeclaration(st)) return true;
  return ts.isVariableStatement(st) && st.declarationList.declarations.every((d) => ts.isIdentifier(d.name) && isPlainExpr(d.initializer, checker));
}

/**
 * Parts of a dropped top-level statement that cannot run when the file loads unless the statement's own binding is
 * referenced from code that does (which pulls the whole statement in as a region of its own): the body of a function
 * or arrow that is directly the initializer of a top-level `const`/`let`/`var`, and the method / accessor / constructor
 * bodies and instance field initializers of a top-level class that runs nothing of its own at load (no decorators,
 * no static blocks, no static field initializers). Everything else in the statement is treated as load-time code:
 * IIFEs, callbacks, object-literal getters, computed keys, decorators, `extends` (rule 5).
 */
function notAtLoad(n: ts.Node, root: ts.Statement): boolean {
  const p = n.parent;
  if (!p) return false;
  if (ts.isVariableDeclaration(p) && p.initializer === n && p.parent.parent === root && isFunctionInit(n as ts.Expression)) return true;
  if (!ts.isClassDeclaration(root) || p.parent !== root || !inertClass(root)) return false;
  if ((ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isConstructorDeclaration(p)) && p.body === n) return true;
  if (ts.isPropertyDeclaration(p) && p.initializer === n && !hasModifier(p, ts.SyntaxKind.StaticKeyword)) return true;
  return false;
}
function inertClass(c: ts.ClassDeclaration): boolean {
  let deco = false;
  const visit = (n: ts.Node): void => {
    if (ts.isDecorator(n)) deco = true;
    else ts.forEachChild(n, visit);
  };
  visit(c);
  if (deco) return false;
  return !c.members.some((m) => ts.isClassStaticBlockDeclaration(m) || (ts.isPropertyDeclaration(m) && hasModifier(m, ts.SyntaxKind.StaticKeyword) && !!m.initializer));
}

/** Globals whose value is a primitive: reading or passing them on cannot change anything. */
const PRIMITIVE_GLOBALS = new Set(['undefined', 'NaN', 'Infinity']);
/**
 * Built-ins every module shares, and the global object under its names: handing one of these to other code
 * (`Object.assign(Math, ...)`, `const A = Array`) may change what the function computes. (Changing ANY global,
 * `x.y = ...` or `x = ...` on a name the file does not declare, is refused whatever the name.)
 */
const SHARED_BUILTINS = new Set<string>([
  'globalThis', 'global', 'self', 'window', 'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Math', 'JSON', 'Reflect', 'Proxy', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'ArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
  'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Iterator', 'Intl', 'Atomics',
]);
const PROTO_NAMES = new Set(['prototype', '__proto__', 'constructor']);

/** The member names along `root`'s access chain (`Array.prototype.includes` -> ['prototype', 'includes']). */
function chainNames(root: ts.Node): { top: ts.Node; names: string[] } {
  const names: string[] = [];
  let n: ts.Node = root;
  for (;;) {
    const p: ts.Node = n.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === n) {
      names.push(p.name.text);
      n = p;
    } else if (ts.isElementAccessExpression(p) && p.expression === n) {
      names.push(ts.isStringLiteralLike(p.argumentExpression) ? p.argumentExpression.text : '[]');
      n = p;
    } else if (ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p)) n = p;
    else break;
  }
  return { top: n, names };
}

/** `Object.getPrototypeOf(x)` / `Reflect.getPrototypeOf(x)`: a built-in prototype, unnamed. */
function isGetPrototypeOf(e: ts.Node): boolean {
  return ts.isCallExpression(e) && ts.isPropertyAccessExpression(unwrap(e.expression)) && (unwrap(e.expression) as ts.PropertyAccessExpression).name.text === 'getPrototypeOf';
}

/**
 * Dropped load-time code that changes a built-in every module shares (finding: `Array.prototype.includes = ...`), or
 * hands one to other code (`Object.assign(Math, ...)`, `const AP = Array.prototype`). Returns the reason, or null.
 */
function changesBuiltin(n: ts.Node, checker: ts.TypeChecker): string | null {
  if (ts.isIdentifier(n)) {
    if (!isReference(n) || inTypePosition(n) || PRIMITIVE_GLOBALS.has(n.text)) return null;
    // (a shorthand `{ Math }` is the VALUE `Math`, not the property the shorthand itself declares)
    const sym = symbolOf(checker, n);
    // `arguments` is the checker's own symbol for the current call's argument list. The object is the call's own, but its
    // `__proto__` is `Object.prototype`, which every module shares: it is treated like a binding of the file, so
    // `arguments[0] = 1` stays allowed and `arguments.__proto__.k = ...` does not.
    if (declaredHere(sym) || n.text === 'arguments') {
      // a binding of the file reaching a SHARED prototype: `o.__proto__.k = ...`, `a.constructor.prototype.x = ...`.
      // (`Foo.prototype.m = ...` on the file's own function or class changes only that declaration.)
      const { names } = chainNames(n);
      const own = (sym?.declarations ?? []).some((d) => ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d));
      const proto = names.some((x) => x === '__proto__' || x === 'constructor') || (names.includes('prototype') && !own);
      if (!proto) return null;
      const use = useOf(n);
      // a method CALLED on the prototype (`o.__proto__.push(7)`, `__defineGetter__`) changes it like an assignment does
      if (use === 'calls' && !isCallApplyBind(names)) return `calls a method on a shared prototype (${[n.text, ...names].join('.')}), which may change it`;
      return use === 'changes' || use === 'passes' ? `reaches a shared prototype through ${[n.text, ...names].join('.')} and changes or passes it on` : null;
    }
    // code from a string can change anything (a direct `eval` even the file's own bindings)
    if (n.text === 'eval' || n.text === 'Function') return `runs code from a string (${n.text}), which may change anything the function reads`;
    const { names } = chainNames(n);
    // `class X extends Error {}` reads the built-in (and its prototype); it changes neither
    const w = wrapped(n);
    if (names.length === 0 && ts.isExpressionWithTypeArguments(w.parent) && ts.isHeritageClause(w.parent.parent)) return null;
    const use = useOf(n);
    if (use === 'changes') return `changes the built-in ${[n.text, ...names].join('.')}, which all code in the program shares`;
    // (`Array[k]` with a key built at run time may be `Array.prototype`, so it counts like a prototype name)
    if (use === 'passes' && ((names.length === 0 && SHARED_BUILTINS.has(n.text)) || names.some((x) => PROTO_NAMES.has(x) || x === '[]'))) {
      return `passes on the built-in ${[n.text, ...names].join('.')}, so other code may change it`;
    }
    // a method CALLED on a shared prototype (`Array.prototype.push(1)`, `Object.prototype.__defineGetter__(...)`) changes it
    // (`Object.prototype.hasOwnProperty.call(o, k)` and `.apply` / `.bind` only look the method up: allowed)
    if (use === 'calls' && names.some((x) => PROTO_NAMES.has(x)) && !isCallApplyBind(names)) {
      return `calls a method on the built-in ${[n.text, ...names].join('.')}, which may change it`;
    }
    return null;
  }
  // a chain rooted at something other than a name: `[].constructor.prototype`, `Object.getPrototypeOf([])`
  if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && !ts.isIdentifier(unwrap(n.expression)) && !ts.isPropertyAccessExpression(unwrap(n.expression)) && !ts.isElementAccessExpression(unwrap(n.expression))) {
    const root = n.expression;
    const { names } = chainNames(root);
    if (!(isGetPrototypeOf(unwrap(root)) || names.some((x) => PROTO_NAMES.has(x)))) return null;
    const use = useOf(root);
    if (use === 'changes' || use === 'passes' || (use === 'calls' && !isCallApplyBind(names))) return 'reaches a built-in prototype and changes, calls a method on, or passes it on';
  }
  return null;
}

/** Is the last member of an access chain `call`, `apply` or `bind` (looking a method up on a prototype, not running it as a method of it)? */
function isCallApplyBind(names: string[]): boolean {
  return ['call', 'apply', 'bind'].includes(names[names.length - 1] ?? '');
}

/** The member name of `x.name` / `x['name']` (null for a key built at run time). */
function memberName(n: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  return null;
}

/** Members that lead to the Function constructor / eval without naming them: `Array.constructor`, `globalThis.eval`. */
const CODE_MEMBERS = new Set(['constructor', 'eval', 'Function']);
const EQUALITY_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/**
 * Reaching code-from-a-string or a built-in prototype WITHOUT naming `eval`, `Function` or `X.prototype`, in dropped
 * load-time code. Returns the reason, or null.
 *
 *  - `.constructor` (`Array.constructor('...')()`, `[].constructor.constructor('...')()`, `fn.constructor`), `.eval`
 *    (`globalThis.eval(...)`) and `.Function`: the value can be the Function constructor, which runs a string as code
 *    that may change anything. The ONLY uses allowed are the ones that cannot call it or keep it: comparing it
 *    (`x.constructor === Foo`), `typeof`, a bare statement, and reading its `.name`.
 *  - `getPrototypeOf` (`Object.getPrototypeOf(x)`, `Reflect.getPrototypeOf(x)`): the result is a shared prototype when
 *    `x` is a built-in value, and `const AP = Object.getPrototypeOf([]); AP.includes = ...` changes it through a binding
 *    the guard does not follow. The call is allowed only when its value is read (compared, tested), never bound, passed on,
 *    called through or assigned to; the function itself used as a value (`const gp = Object.getPrototypeOf`) is refused.
 *
 * The guard follows names, not values: a key built at run time that is CALLED straight away (`Array[k]('...')()`) is not
 * caught; the same key read into a binding, passed on or assigned through is (a limit stated in docs/SECURITY.md).
 */
function reachesCode(n: ts.Node): string | null {
  const name = memberName(n);
  if (name === null) return null;
  const w = wrapped(n);
  const p = w.parent;
  if (name === 'getPrototypeOf') {
    if (!(ts.isCallExpression(p) && p.expression === w)) return 'passes on getPrototypeOf, which hands out a built-in prototype';
    return useOf(p) === 'read' ? null : 'keeps the result of getPrototypeOf, which can be a built-in prototype that every module shares';
  }
  if (!CODE_MEMBERS.has(name)) return null;
  if (ts.isPropertyAccessExpression(p) && p.expression === w && p.name.text === 'name') return null;
  if (ts.isBinaryExpression(p) && EQUALITY_OPS.has(p.operatorToken.kind)) return null;
  if (ts.isTypeOfExpression(p) || ts.isExpressionStatement(p)) return null;
  return `reaches .${name}, which can be the Function constructor (code from a string, which may change anything the function reads)`;
}

/**
 * `reachesCode` and `changesBuiltin` follow `x.constructor` and `x['__proto__']`; a destructuring pattern names the same
 * members without an access expression (`const { constructor: C } = []`, `const { __proto__: P } = []`, `const {
 * constructor: { prototype: AP } } = []`, `({ eval: ev } = globalThis)`), and the binding it creates looks like an ordinary
 * local. Any pattern that picks `constructor`, `__proto__`, `prototype`, `eval` or `Function` by name, in dropped load-time
 * code, is refused. (A key built at run time, `const { [k]: v } = x`, is the documented limit.) Returns the reason, or null.
 */
const PATTERN_MEMBERS = new Set(['constructor', '__proto__', 'prototype', 'eval', 'Function']);
function reachesByDestructuring(n: ts.Node): string | null {
  let name: ts.PropertyName | undefined;
  if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) name = n.propertyName ?? (ts.isIdentifier(n.name) ? n.name : undefined);
  else if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && isAssignmentTarget(n)) name = n.name;
  if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name))) return null;
  return PATTERN_MEMBERS.has(name.text) ? `picks .${name.text} out of an object by destructuring, which can be a built-in prototype or the Function constructor (code from a string, which may change anything the function reads)` : null;
}

/** Is `n` (part of) the left side of an assignment, including destructuring targets? */
function isAssignmentTarget(n: ts.Node): boolean {
  let c: ts.Node = n;
  for (;;) {
    const p: ts.Node = c.parent;
    if (!p) return false;
    if (ts.isBinaryExpression(p) && ASSIGNMENT_OPS.has(p.operatorToken.kind)) return p.left === c;
    if (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p) || ts.isParenthesizedExpression(p)) {
      if (ts.isPropertyAssignment(p) && p.name === c) return false;
      c = p;
      continue;
    }
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === c) return true;
    return false;
  }
}

/** What a dropped alias statement binds a name to (see `builtinAliases`). */
interface Alias {
  /** `'code'`: the bare global `eval` / `Function`. `'proto'`: `Object.getPrototypeOf` / `Reflect.getPrototypeOf`. */
  kind: 'code' | 'proto';
  /** The aliased expression as written, for the reason. */
  of: string;
}

/**
 * Alias statements: `const RealFunction = Function;`, `const e = eval;`, `const getProto = Object.getPrototypeOf;`. A top-level
 * `const` whose every declarator is a plain name bound to exactly one of those. Returns the names it declares with what
 * each stands for, or null when the statement is anything else.
 *
 * SOUNDNESS of dropping such a statement (extractUnit, rule 5): evaluating it only READS a global (`Function`, or the
 * property `getPrototypeOf` of `Object` / `Reflect`); it calls nothing and changes nothing. The alias can matter only if
 * code that RUNS while the file loads uses the name, and the name is a lexical binding, so every such use is a syntactic
 * reference to it. Rule 5 scans all of that code (the dropped load-time statements and every dropped declaration they
 * reach) and checks each reference to the alias like the built-in it stands for:
 *   - `'code'`: ANY reference is refused (calling it, passing it on, reading it): it is code from a string.
 *   - `'proto'`: the reference must be the callee of a call whose result is only read (compared, tested), exactly the
 *     rule for writing `Object.getPrototypeOf(x)` out in full (`reachesCode`); anything else (`const AP = gp([])`, `gp(x).k
 *     = 1`, `xs.map(gp)`) is refused, because the result can be a prototype every module shares.
 * References from code that does not run at load (the body of a function nothing calls while the file loads) cannot
 * matter, and a reference from the function's own closure includes the statement in the unit (then rule 3 refuses
 * `Function`, which the sandbox traps). Nearest unsafe shapes that stay refused: `const e = eval; e('cfg.k = 100')`, whose
 * string has no syntactic link to `cfg`; `const gp = Object.getPrototypeOf; const AP = gp([]); AP.includes = ...`.
 */
function builtinAliases(st: ts.Statement, checker: ts.TypeChecker): Array<[ts.Identifier, Alias]> | null {
  if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const) || hasModifier(st, ts.SyntaxKind.DeclareKeyword)) return null;
  const out: Array<[ts.Identifier, Alias]> = [];
  for (const d of st.declarationList.declarations) {
    if (!ts.isIdentifier(d.name) || !d.initializer) return null;
    const init = unwrap(d.initializer);
    const global = (id: ts.Node): id is ts.Identifier => ts.isIdentifier(id) && !declaredHere(checker.getSymbolAtLocation(id));
    if (global(init) && (init.text === 'eval' || init.text === 'Function')) out.push([d.name, { kind: 'code', of: init.text }]);
    else if (memberName(init) === 'getPrototypeOf' && (ts.isPropertyAccessExpression(init) || ts.isElementAccessExpression(init))) {
      const root = unwrap(init.expression);
      if (!global(root) || (root.text !== 'Object' && root.text !== 'Reflect')) return null;
      out.push([d.name, { kind: 'proto', of: `${root.text}.getPrototypeOf` }]);
    } else return null;
  }
  return out.length ? out : null;
}

/**
 * Is `id` only STORED in the module's default export: `export default id`, `export default { a: id, id }`,
 * `export default [id]` (any nesting of object / array literals made of plain properties and elements)?
 *
 * SOUNDNESS (extractUnit, rule 5, "reached from load-time code"): evaluating such an expression creates an object (or
 * evaluates a name) and stores a reference; it runs nothing of the referenced function or class. The result is bound to no
 * name of this file, so no code of this file can call it through the export while the file loads (another module can, only
 * after this one has finished evaluating; the honest limit about other modules). Every other member of the literal
 * (a method, a getter, a call, a spread, a computed key) is load-time code scanned on its own. Anything else that
 * merely MENTIONS a declaration (`const api = { f }; api.f()`, `[f].map((g) => g())`, `export default f()`) still
 * reaches it.
 */
function storedInDefaultExport(id: ts.Identifier): boolean {
  let c: ts.Node = wrapped(id);
  for (;;) {
    const p: ts.Node | undefined = c.parent;
    if (!p) return false;
    if (ts.isShorthandPropertyAssignment(p)) {
      if (p.name !== c || p.objectAssignmentInitializer) return false;
    } else if (ts.isPropertyAssignment(p)) {
      if (p.initializer !== c) return false;
    } else if (ts.isObjectLiteralExpression(p) || ts.isArrayLiteralExpression(p)) {
      if (!(ts.isObjectLiteralExpression(p) ? p.properties : p.elements).some((m: ts.Node) => m === c)) return false;
    } else if (ts.isExportAssignment(p)) {
      return !p.isExportEquals && p.expression === c;
    } else return false;
    c = wrapped(p);
  }
}

function forEachIdentifier(root: ts.Node, f: (id: ts.Identifier) => void): void {
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) f(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
}

/** The text of a top-level statement with its leading JSDoc. */
function statementText(sf: ts.SourceFile, st: ts.Statement): { start: number; text: string } {
  const docs = ts.getJSDocCommentsAndTags(st).filter(ts.isJSDoc);
  const start = docs.length ? docs[0]!.getStart(sf) : st.getStart(sf);
  return { start, text: sf.text.slice(start, st.end) };
}

/** Extract `fnName` and the module-level declarations it needs from `source` (see the rules above). */
export function extractUnit(source: string, fnName: string, fileName = 'unit.ts'): ExtractResult {
  void fileName;
  const a = analyse(source);
  const { sf, checker } = a;
  const at = (pos: number) => lineCol(sf, pos);
  if (a.parseError) return { ok: false, reason: `the file does not parse: ${a.parseError.message}`, ...at(a.parseError.pos) };

  const targets = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fnName);
  const impl = targets.find((t) => !!t.body);
  if (!impl) {
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === fnName && isFunctionInit(d.initializer)) {
          return { ok: false, reason: `${fnName} is a function stored in a variable; the Tested tier runs only function declarations such as \`function ${fnName}(...) { ... }\``, ...at(st.getStart(sf)) };
        }
      }
    }
    return { ok: false, reason: `no function declaration named ${fnName} with a body was found` };
  }
  if (targets.length > 1) {
    // The delivered patch and the signature inputs are built for ONE declaration; an overload group would be spliced and
    // sampled wrongly (only the first signature), so it is refused here and, through `sameForWholeFile`, for the whole file.
    return { ok: false, reason: `${fnName} is overloaded (${targets.length - 1} signature${targets.length === 2 ? '' : 's'} before the implementation); the Tested tier does not run overloaded functions yet`, ...at(targets[0]!.getStart(sf)), sameForWholeFile: true };
  }
  const targetSym = checker.getSymbolAtLocation(impl.name!);
  if (a.nestedVarNames.has(fnName)) {
    return { ok: false, reason: `${fnName} is declared again with \`var\` inside a block of the file (a nested \`var\` is the same variable)`, ...at(targets[0]!.getStart(sf)) };
  }

  // ── closure ──
  const included = new Set<ts.Statement>(targets);
  const queue: ts.Statement[] = [...targets];
  let functionUsedAsObject = false;
  while (queue.length) {
    const st = queue.shift()!;
    let fail: ExtractResult | null = null;
    const visit = (n: ts.Node): void => {
      if (fail) return;
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        fail = { ok: false, reason: 'it loads another module with import()', ...at(n.getStart(sf)) };
        return;
      }
      // a DIRECT eval runs its string in the scope of the function, where every name of the file is visible, including
      // the ones the unit leaves out (`eval('n + cfg.k')`); an indirect or aliased eval sees only the global scope
      // (`(eval)(s)` and `(eval as any)(s)` are direct too: parentheses keep the reference)
      const callee = ts.isCallExpression(n) ? unwrap(n.expression) : null;
      if (callee && ts.isIdentifier(callee) && callee.text === 'eval' && !declaredHere(checker.getSymbolAtLocation(callee))) {
        fail = { ok: false, reason: 'it calls eval, which can read any name in the file, including ones the extracted unit leaves out', ...at(n.getStart(sf)) };
        return;
      }
      if (ts.isImportTypeNode(n)) {
        fail = { ok: false, reason: 'the types it uses refer to another module (an import(...) type)', ...at(n.getStart(sf)) };
        return;
      }
      if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) {
        fail = { ok: false, reason: 'it uses import.meta', ...at(n.getStart(sf)) };
        return;
      }
      if ((ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier)) && runsAtLoad(n, st)) {
        fail = { ok: false, reason: 'a declaration it uses waits at the top level of the file (top-level await)', ...at(n.getStart(sf)) };
        return;
      }
      if (ts.isIdentifier(n) && isReference(n)) {
        const sym = symbolOf(checker, n);
        const typePos = inTypePosition(n);
        const imp = sym ? a.imports.get(sym) : undefined;
        if (imp) {
          fail = {
            ok: false,
            reason: typePos
              ? `the types it uses include ${n.text}, imported from '${imp.module}'`
              : `it uses ${n.text}, imported from '${imp.module}'`,
            ...at(n.getStart(sf)),
          };
          return;
        }
        const sts = sym ? a.decls.get(sym) : undefined;
        // A `var` nested in another statement of the file (`if (c) { var x = 1 }`, `for (var x of xs)`) declares or
        // re-declares a MODULE-level variable that dropping that statement would change or remove (`var x = 1; if (c) {
        // var x = 100 }` makes x 100; `if (c) { var x = 1 }` alone defines x). Not followed: refused when the function reads it.
        if (!typePos && a.nestedVarNames.has(n.text) && (sts || (sym?.declarations ?? []).some((d) => ts.isVariableDeclaration(d) && a.nestedVars.has(d)))) {
          fail = { ok: false, reason: `it uses ${n.text}, which another statement of the file declares again with \`var\` inside a block (a nested \`var\` is the same variable)`, ...at(n.getStart(sf)) };
          return;
        }
        if (sts) {
          for (const d of sts) {
            if (ts.isModuleDeclaration(d)) {
              fail = { ok: false, reason: `it uses the namespace ${n.text}; namespaces are not supported`, ...at(n.getStart(sf)) };
              return;
            }
            if (!typePos && hasModifier(d, ts.SyntaxKind.DeclareKeyword) && !ts.isInterfaceDeclaration(d) && !ts.isTypeAliasDeclaration(d)) {
              fail = { ok: false, reason: `it uses ${n.text}, which this file only declares (\`declare\`): its value comes from outside the file`, ...at(n.getStart(sf)) };
              return;
            }
          }
          // an included function used as anything but a callee (`h.k`, `h['k']`, `const a = h`, `xs.map(h)`) may carry
          // state attached to it as an object (rule 5)
          if (!typePos && sts.some((d) => ts.isFunctionDeclaration(d)) && !onlyCalled(n)) functionUsedAsObject = true;
          for (const d of sts) {
            if (!included.has(d)) {
              included.add(d);
              queue.push(d);
            }
          }
        } else if (!declaredHere(sym) && !typePos && TRAPPED_SET.has(n.text) && runsAtLoad(n, st)) {
          fail = { ok: false, reason: `a declaration it uses reads ${n.text} when the file loads`, ...at(n.getStart(sf)) };
          return;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(st);
    if (fail) return fail;
  }

  // ── soundness guard over dropped top-level code (rule 5) ──
  const includedSyms = new Map<ts.Symbol, ts.Statement[]>();
  for (const [sym, sts] of a.decls) if (sts.some((s) => included.has(s))) includedSyms.set(sym, sts);
  const mutableState = functionUsedAsObject || [...included].some(holdsMutableState);
  const dropped = sf.statements.filter((s) => !included.has(s));
  const skipKinds = (s: ts.Statement): boolean =>
    ts.isImportDeclaration(s) ||
    ts.isImportEqualsDeclaration(s) ||
    ts.isExportDeclaration(s) ||
    ts.isInterfaceDeclaration(s) ||
    ts.isTypeAliasDeclaration(s) ||
    hasModifier(s, ts.SyntaxKind.DeclareKeyword);
  // regions of dropped code that may run when the file loads: [statement, loadTimeOnly]. A load-time region is the
  // WHOLE statement except the parts `notAtLoad` names (a function's body cannot run unless its binding is referenced
  // from load-time code, and such a reference pulls the declaration in as a full region).
  const aliasOf = new Map<ts.Symbol, Alias>(); // `const RealFunction = Function` -> { kind: 'code', of: 'Function' }
  const aliasStmts = new Set<ts.Statement>();
  for (const s of dropped) {
    const aliases = builtinAliases(s, checker);
    if (!aliases) continue;
    aliasStmts.add(s);
    for (const [id, al] of aliases) {
      const sym = checker.getSymbolAtLocation(id);
      if (sym) aliasOf.set(sym, al);
    }
  }
  const regions: Array<[ts.Statement, boolean]> = dropped.filter((s) => !skipKinds(s) && !ts.isFunctionDeclaration(s) && !aliasStmts.has(s)).map((s) => [s, true]);
  const pulled = new Set<ts.Statement>();
  const plain = (sts: ts.Statement[]): boolean => sts.every((d) => isPlainData(d, checker));
  for (let i = 0; i < regions.length; i++) {
    const [root, loadOnly] = regions[i]!;
    let fail: ExtractResult | null = null;
    const refuse = (n: ts.Node, words: string): void => {
      const { line } = at(n.getStart(sf));
      fail = { ok: false, reason: `module-level code outside the function (line ${line}) ${words}`, ...at(n.getStart(sf)) };
    };
    const visit = (n: ts.Node): void => {
      if (fail) return;
      if (loadOnly && notAtLoad(n, root)) return;
      const builtin = changesBuiltin(n, checker);
      if (builtin) return refuse(n, builtin);
      const viaMember = reachesCode(n);
      if (viaMember) return refuse(n, viaMember);
      const viaPattern = reachesByDestructuring(n);
      if (viaPattern) return refuse(n, viaPattern);
      if (ts.isIdentifier(n) && isReference(n) && !inTypePosition(n)) {
        const sym = symbolOf(checker, n);
        const alias = sym ? aliasOf.get(sym) : undefined;
        if (alias?.kind === 'code') return refuse(n, `uses ${n.text}, which is another name for ${alias.of}: it runs code from a string, which may change anything the function reads`);
        if (alias) {
          const w = wrapped(n);
          if (!(ts.isCallExpression(w.parent) && w.parent.expression === w && useOf(w.parent) === 'read')) {
            return refuse(n, `keeps or passes on the result of ${n.text}, which is another name for ${alias.of} and can return a built-in prototype that every module shares`);
          }
        }
        const sts = sym ? includedSyms.get(sym) : undefined;
        if (sym && sts) {
          const frozen = sts.every(isFrozenConst);
          const isFn = sts.every((d) => ts.isFunctionDeclaration(d));
          let use: Use | 'runs-code' = frozen ? 'read' : useOf(n);
          // reading a value that is not plain data may run code of the file (a getter, `valueOf`, `toString`)
          if (use === 'read' && !frozen && !isFn && !plain(sts) && !ts.isTypeOfExpression(wrapped(n).parent)) use = 'runs-code';
          if (isFn && !mutableState && (use === 'calls' || use === 'passes')) {
            // Running an included function while the file loads also runs what it does to built-ins and what it returns
            // (`function patch() { Array.prototype.includes = ... } patch();`, `function M() { return Math } M().max = ...`):
            // scan its body like any other load-time code (the whole file is evaluated with that call, the unit without it).
            for (const d of sts) {
              if (pulled.has(d)) continue;
              pulled.add(d);
              regions.push([d, false]);
            }
          }
          if (use !== 'read' && !(isFn && !mutableState && (use === 'calls' || use === 'passes'))) {
            const what = sym === targetSym ? 'the function itself' : n.text;
            const words =
              use === 'changes'
                ? `changes ${what}, which the function reads`
                : use === 'runs-code'
                  ? `reads ${what}, which is not plain data: reading it may run code (a getter, valueOf) that changes state the function reads`
                  : sym === targetSym
                    ? `${use === 'calls' ? 'runs the function itself' : 'passes the function itself on'} while the file loads; that may change state the function reads`
                    : `${use === 'calls' ? (isFn ? 'runs' : 'calls a method of') : 'passes on'} ${what}, which the function uses; that code may change state the function reads`;
            return refuse(n, words);
          }
        } else if (sym) {
          // a dropped declaration referenced from load-time code may run (all of it) when the file loads; one that is only
          // stored in the default export does not (storedInDefaultExport)
          const stored = storedInDefaultExport(n);
          for (const d of stored ? [] : (a.decls.get(sym) ?? [])) {
            if (included.has(d) || skipKinds(d) || pulled.has(d) || aliasStmts.has(d)) continue;
            pulled.add(d);
            regions.push([d, false]);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
    if (fail) return fail;
  }

  // ── disclosure: included state that dropped code can change later, in a function body or class member that nothing
  // in the file runs when it loads (rule 5 refused everything that does) ──
  const caveats: string[] = [];
  const touched = new Map<string, Set<number>>();
  for (const st of dropped) {
    if (skipKinds(st)) continue;
    forEachIdentifier(st, (n) => {
      if (!isReference(n) || inTypePosition(n)) return;
      const sym = symbolOf(checker, n);
      const sts = sym ? includedSyms.get(sym) : undefined;
      if (!sts || !sts.some(holdsMutableState) || useOf(n) === 'read') return;
      const lines = touched.get(n.text) ?? new Set<number>();
      lines.add(at(n.getStart(sf)).line);
      touched.set(n.text, lines);
    });
  }
  for (const [name, lines] of touched) {
    const ls = [...lines].sort((x, y) => x - y);
    caveats.push(
      `other code in this file (line${ls.length === 1 ? '' : 's'} ${ls.join(', ')}) can change ${name} when it is called; nothing in the file calls it while the file loads and the comparison never called it, so the comparison saw only the starting value of ${name}`,
    );
  }

  // ── the unit ──
  const notes: string[] = [...caveats];
  const exported = hasModifier(impl, ts.SyntaxKind.ExportKeyword);
  const parts: string[] = [];
  const decls: IncludedDecl[] = [];
  const lineMap: number[] = [];
  for (const st of sf.statements) {
    if (!included.has(st)) continue;
    let { start, text } = statementText(sf, st);
    if (targets.includes(st as ts.FunctionDeclaration)) {
      if (!exported) {
        const off = st.getStart(sf) - start;
        text = text.slice(0, off) + 'export ' + text.slice(off);
      }
    } else {
      const line = at(st.getStart(sf)).line;
      for (const id of a.names.get(st) ?? []) decls.push({ kind: kindOf(st), name: id.text, line });
    }
    const first = at(start).line;
    const count = text.split('\n').length;
    for (let k = 0; k < count; k++) lineMap.push(first + k);
    parts.push(text);
  }
  if (!exported) notes.push(`${fnName} is not exported in its file; the unit exports it so the checks can find it`);
  const imports = sf.statements.filter((s) => ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s)).length;
  const other = dropped.filter((s) => !ts.isImportDeclaration(s) && !ts.isImportEqualsDeclaration(s)).length;
  if (imports) notes.push(`left out ${imports} import${imports === 1 ? '' : 's'} the function does not use`);
  if (other) notes.push(`left out ${other} other top-level statement${other === 1 ? '' : 's'} the function does not use`);
  return { ok: true, unit: parts.join('\n') + '\n', included: decls, notes, caveats, lineMap };
}

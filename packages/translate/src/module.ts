/**
 * Module scan (red-team round 2, mathFloorPatched / mathAbsPatched): the translation unit is the function together
 * with the module it lives in. Loading a module runs its top-level statements, and a statement such as
 * `Math.floor = (x) => x` changes what the function computes while the model keeps the builtin's meaning. The plain
 * original the harness runs (`plainTs`) carries only the function and the literal constants it reads, so the harness
 * could not see such a statement either.
 *
 * Rule: every top-level statement must be inert, i.e. evaluating it when the module loads runs no user code and no
 * builtin with an observable effect. Allowed:
 *  - function declarations (bodies run only when called; calls to other functions are refused by the lowering),
 *    interfaces, type aliases, empty statements, `'use strict'`-style directives;
 *  - anything with a `declare` modifier (no runtime code), and namespaces that contain only types/declarations;
 *  - `import type ...` / imports whose every specifier is `type` (erased), `export { a, b }` without a module
 *    specifier, `export type ... from`;
 *  - `const`/`let`/`var` declarations (identifier names) whose initializers are inert values (see `inertValue`),
 *    `export default <inert value>`, enums whose initializers are inert primitives.
 * Refused (`unsupported-syntax`, span = the statement): expression statements, classes (static initializers, static
 * blocks, decorators and `extends` run at load; none of the corpora needs a class), value imports and re-exports
 * from a module (they run the other module's top-level code, which the translator cannot see), `import x = ...`,
 * `using` declarations (their disposers run at the end of module evaluation), destructuring declarations (they can
 * run getters), and every other statement (control flow at module level).
 */
import ts from 'typescript';
import { refuse } from './types.js';

const K = ts.SyntaxKind;

const REASON =
  'this top-level statement runs code when the module loads (it could replace builtins such as Math.floor, or change state the function sees); ' +
  'subset v1 allows only function, type and constant declarations with literal or function initializers at module level';

function hasModifier(n: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);
}

function strip(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e))
    e = e.expression;
  return e;
}

/**
 * A primitive computed from literals only: no operand can be an object, so no user `valueOf`/`toString`/getter runs.
 */
function inertPrim(e0: ts.Expression): boolean {
  const e = strip(e0);
  switch (e.kind) {
    case K.NumericLiteral:
    case K.BigIntLiteral:
    case K.StringLiteral:
    case K.NoSubstitutionTemplateLiteral:
    case K.TrueKeyword:
    case K.FalseKeyword:
    case K.NullKeyword:
      return true;
    case K.PrefixUnaryExpression: {
      const p = e as ts.PrefixUnaryExpression;
      return p.operator !== K.PlusPlusToken && p.operator !== K.MinusMinusToken && inertPrim(p.operand);
    }
    case K.BinaryExpression: {
      const b = e as ts.BinaryExpression;
      const op = b.operatorToken.kind;
      if (op >= K.FirstAssignment && op <= K.LastAssignment) return false;
      if (op === K.InKeyword || op === K.InstanceOfKeyword) return false;
      return inertPrim(b.left) && inertPrim(b.right);
    }
    case K.TemplateExpression:
      return (e as ts.TemplateExpression).templateSpans.every((s) => inertPrim(s.expression));
    default:
      return false;
  }
}

/** A value whose creation runs no user code: inert primitives, identifiers, functions, and literals of these. */
function inertValue(e0: ts.Expression): boolean {
  const e = strip(e0);
  if (inertPrim(e)) return true;
  switch (e.kind) {
    case K.Identifier: // reading a binding (a builtin global or a declaration of this file) runs nothing
    case K.ArrowFunction:
    case K.FunctionExpression:
    case K.RegularExpressionLiteral:
      return true;
    case K.ArrayLiteralExpression:
      // no spread: spreading runs an iterator
      return (e as ts.ArrayLiteralExpression).elements.every((x) => !ts.isSpreadElement(x) && (ts.isOmittedExpression(x) || inertValue(x)));
    case K.ObjectLiteralExpression:
      return (e as ts.ObjectLiteralExpression).properties.every((p) => {
        if (ts.isSpreadAssignment(p)) return false; // spreading runs getters
        if (p.name && ts.isComputedPropertyName(p.name) && !inertPrim(p.name.expression)) return false; // ToPropertyKey can run toString
        if (ts.isPropertyAssignment(p)) return inertValue(p.initializer);
        if (ts.isShorthandPropertyAssignment(p)) return !p.objectAssignmentInitializer;
        return ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p); // defined, not run
      });
    default:
      return false;
  }
}

/** Only types and declarations inside (a namespace that TypeScript does not instantiate at runtime). */
function typesOnly(s: ts.Statement): boolean {
  if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || hasModifier(s, K.DeclareKeyword)) return true;
  if (ts.isModuleDeclaration(s)) {
    let b: ts.ModuleBody | ts.JSDocNamespaceDeclaration | undefined = s.body;
    while (b && ts.isModuleDeclaration(b)) b = b.body;
    return !b || (ts.isModuleBlock(b) && b.statements.every(typesOnly));
  }
  return false;
}

function inertStatement(s: ts.Statement): boolean {
  if (hasModifier(s, K.DeclareKeyword)) return true;
  switch (s.kind) {
    case K.FunctionDeclaration:
    case K.InterfaceDeclaration:
    case K.TypeAliasDeclaration:
    case K.EmptyStatement:
      return true;
    case K.ModuleDeclaration:
      return typesOnly(s);
    case K.ExpressionStatement:
      // directive prologue (`'use strict'`): a string literal statement evaluates nothing
      return ts.isStringLiteral((s as ts.ExpressionStatement).expression);
    case K.ImportDeclaration: {
      const i = s as ts.ImportDeclaration;
      const c = i.importClause;
      if (!c) return false; // `import './x'`: run only for its effects
      if (c.isTypeOnly) return true;
      return !c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((el) => el.isTypeOnly);
    }
    case K.ExportDeclaration: {
      const d = s as ts.ExportDeclaration;
      return d.isTypeOnly || !d.moduleSpecifier;
    }
    case K.ExportAssignment:
      return inertValue((s as ts.ExportAssignment).expression);
    case K.EnumDeclaration:
      return (s as ts.EnumDeclaration).members.every((m) => !m.initializer || inertPrim(m.initializer));
    case K.VariableStatement: {
      const list = (s as ts.VariableStatement).declarationList;
      if (list.flags & ts.NodeFlags.Using) return false; // `using` and `await using` (AwaitUsing = Using | Const)
      return list.declarations.every((d) => ts.isIdentifier(d.name) && (!d.initializer || inertValue(d.initializer)));
    }
    default:
      return false;
  }
}

/** Refuse the first top-level statement (source order) that is not inert. */
export function scanModule(sf: ts.SourceFile): void {
  for (const s of sf.statements) if (!inertStatement(s)) refuse('unsupported-syntax', REASON, s);
}

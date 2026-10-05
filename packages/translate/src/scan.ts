/**
 * Feature scan: one pre-order, source-order walk over the function that refuses the "feature" codes
 * (regex, date, map-set, nan, io, random, async, generic, bitwise, this, float, non-bmp, dictionary).
 * The first offending node in source order wins. Structural refusals (unsupported-syntax, unsupported-library,
 * mutable-capture, no-termination-measure, ...) come later, from the lowering.
 */
import ts from 'typescript';
import { refuse } from './types.js';
import type { RefusalCode } from './contracts.js';

const K = ts.SyntaxKind;

const GLOBAL_CODES: Record<string, [RefusalCode, string]> = {
  RegExp: ['regex', 'regular expressions are outside subset v1'],
  Date: ['date', 'Date is outside subset v1 (time is not a pure input)'],
  Map: ['map-set', 'Map is outside subset v1'],
  Set: ['map-set', 'Set is outside subset v1'],
  WeakMap: ['map-set', 'WeakMap is outside subset v1'],
  WeakSet: ['map-set', 'WeakSet is outside subset v1'],
  NaN: ['nan', 'NaN is outside subset v1 (numbers are integers)'],
  isNaN: ['nan', 'isNaN is outside subset v1 (numbers are integers)'],
  Infinity: ['float', 'Infinity is not an integer'],
  parseFloat: ['float', 'parseFloat produces non-integer numbers'],
  console: ['io', 'console output is I/O'],
  process: ['io', 'process is I/O'],
  require: ['io', 'require is I/O'],
  fetch: ['io', 'fetch is I/O'],
  document: ['io', 'document is I/O'],
  window: ['io', 'window is I/O'],
  globalThis: ['io', 'globalThis gives access to I/O'],
  setTimeout: ['io', 'timers are I/O'],
  setInterval: ['io', 'timers are I/O'],
  queueMicrotask: ['io', 'task queues are I/O'],
  alert: ['io', 'alert is I/O'],
  prompt: ['io', 'prompt is I/O'],
  localStorage: ['io', 'localStorage is I/O'],
  sessionStorage: ['io', 'sessionStorage is I/O'],
  XMLHttpRequest: ['io', 'XMLHttpRequest is I/O'],
  performance: ['io', 'performance timers are I/O'],
  crypto: ['random', 'crypto is a source of randomness'],
  Promise: ['async', 'Promise is asynchronous'],
};

const MATH_FLOAT = new Set([
  'sqrt', 'cbrt', 'pow', 'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'hypot', 'fround', 'round', 'PI', 'E', 'LN2', 'LN10',
  'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2',
]);

const NUMBER_CODES: Record<string, [RefusalCode, string]> = {
  NaN: ['nan', 'Number.NaN is outside subset v1'],
  isNaN: ['nan', 'Number.isNaN is outside subset v1'],
  POSITIVE_INFINITY: ['float', 'Infinity is not an integer'],
  NEGATIVE_INFINITY: ['float', 'Infinity is not an integer'],
  EPSILON: ['float', 'Number.EPSILON is not an integer'],
  parseFloat: ['float', 'parseFloat produces non-integer numbers'],
  MIN_VALUE: ['float', 'Number.MIN_VALUE is not an integer'],
};

const BITWISE_BINARY = new Set<ts.SyntaxKind>([
  K.AmpersandToken, K.BarToken, K.CaretToken, K.LessThanLessThanToken, K.GreaterThanGreaterThanToken,
  K.GreaterThanGreaterThanGreaterThanToken, K.AmpersandEqualsToken, K.BarEqualsToken, K.CaretEqualsToken,
  K.LessThanLessThanEqualsToken, K.GreaterThanGreaterThanEqualsToken, K.GreaterThanGreaterThanGreaterThanEqualsToken,
]);

/** Does `s` contain a UTF-16 surrogate code unit (astral character or lone surrogate)? */
export function hasSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) return true;
  }
  return false;
}

/**
 * Is `id` a global from the lib files (not declared in the user's file)? Every declaration of its symbol must lie
 * outside `sf`: a module-level `const Math = ...`, `function Math()`, `import { Math }` or `declare var Math` in the
 * file shadows the builtin (red-team round 2, moduleMathShadow), so it is not the global. Interface declarations in the
 * file (`declare global { interface Math { ... } }`) merge into the lib's type only and have no runtime effect.
 */
export function isGlobal(checker: ts.TypeChecker, id: ts.Identifier, sf: ts.SourceFile): boolean {
  const sym = checker.getSymbolAtLocation(id);
  if (!sym) return true;
  const decls = sym.getDeclarations() ?? [];
  return decls.length === 0 || decls.every((d) => d.getSourceFile() !== sf || ts.isInterfaceDeclaration(d));
}

/** Identifiers in a "name" position (property names, keys) are not variable references. */
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isPropertyAssignment(p) && p.name === id) return true;
  if (ts.isPropertySignature(p) && p.name === id) return true;
  if ((ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name === id) return true;
  if (ts.isTypeReferenceNode(p) || ts.isQualifiedName(p)) return true; // handled as types
  if (ts.isBreakOrContinueStatement(p) || ts.isLabeledStatement(p)) return true;
  return false;
}

function unparen(e: ts.Node): ts.Node {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/** `/` is accepted only as the single argument of `Math.floor(...)` / `Math.ceil(...)` (see DESIGN.md). */
function isFloorCeilDivision(bin: ts.BinaryExpression): boolean {
  let n: ts.Node = bin;
  while (n.parent && ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const call = n.parent;
  if (!call || !ts.isCallExpression(call) || call.arguments.length !== 1 || call.arguments[0] !== n) return false;
  const callee = call.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Math' &&
    (callee.name.text === 'floor' || callee.name.text === 'ceil')
  );
}

export function scanFeatures(root: ts.Node, checker: ts.TypeChecker, sf: ts.SourceFile): void {
  const visit = (node: ts.Node): void => {
    switch (node.kind) {
      case K.RegularExpressionLiteral:
        refuse('regex', 'regular expressions are outside subset v1', node);
      case K.ThisKeyword:
        refuse('this', '`this` is outside subset v1: the function must be a pure function of its arguments', node);
      case K.AwaitExpression:
        refuse('async', '`await` is outside subset v1', node);
      case K.YieldExpression:
        refuse('async', 'generators are outside subset v1', node);
      case K.NumericLiteral: {
        const v = Number((node as ts.NumericLiteral).text.replace(/_/g, ''));
        if (!Number.isInteger(v)) refuse('float', `the number literal ${(node as ts.NumericLiteral).getText(sf)} is not an integer`, node);
        break;
      }
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
      case K.TemplateHead:
      case K.TemplateMiddle:
      case K.TemplateTail: {
        const text = (node as ts.LiteralLikeNode).text;
        if (hasSurrogate(text))
          refuse('non-bmp', 'this string literal contains characters outside the Basic Multilingual Plane (or a lone surrogate); strings are modeled as BMP text', node);
        break;
      }
      case K.PrefixUnaryExpression:
        if ((node as ts.PrefixUnaryExpression).operator === K.TildeToken) refuse('bitwise', 'bitwise operators are outside subset v1', node);
        break;
      case K.BinaryExpression: {
        const b = node as ts.BinaryExpression;
        const op = b.operatorToken.kind;
        if (BITWISE_BINARY.has(op)) refuse('bitwise', `the bitwise operator \`${b.operatorToken.getText(sf)}\` is outside subset v1`, b.operatorToken);
        if (op === K.SlashEqualsToken) refuse('float', '`/=` produces non-integer numbers', b.operatorToken);
        if (op === K.SlashToken && !isFloorCeilDivision(b))
          refuse('float', '`a / b` is not provably an integer; use Math.floor(a / b) or Math.ceil(a / b)', node);
        break;
      }
      case K.Identifier: {
        const id = node as ts.Identifier;
        if (isNamePosition(id)) break;
        const hit = GLOBAL_CODES[id.text];
        if (hit && isGlobal(checker, id, sf)) refuse(hit[0], hit[1], id);
        break;
      }
      case K.PropertyAccessExpression: {
        const pa = node as ts.PropertyAccessExpression;
        if (ts.isIdentifier(pa.expression) && isGlobal(checker, pa.expression, sf)) {
          const obj = pa.expression.text;
          const prop = pa.name.text;
          if (obj === 'Math' && prop === 'random') refuse('random', 'Math.random is a source of randomness', pa);
          if (obj === 'Math' && MATH_FLOAT.has(prop)) refuse('float', `Math.${prop} produces non-integer numbers`, pa);
          if (obj === 'Number' && NUMBER_CODES[prop]) refuse(NUMBER_CODES[prop]![0], NUMBER_CODES[prop]![1], pa);
        }
        if (pa.name.text === 'toFixed' || pa.name.text === 'toPrecision') refuse('float', `.${pa.name.text} is a floating-point operation`, pa.name);
        break;
      }
      case K.CallExpression:
      case K.NewExpression: {
        const c = node as ts.CallExpression | ts.NewExpression;
        if (ts.isIdentifier(c.expression)) {
          const hit = GLOBAL_CODES[c.expression.text];
          if (hit && isGlobal(checker, c.expression, sf)) refuse(hit[0], hit[1], c.expression);
        }
        if (c.typeArguments && c.typeArguments.length > 0) refuse('generic', 'explicit type arguments (generics) are outside subset v1', c.typeArguments[0]!);
        break;
      }
      case K.ArrowFunction:
      case K.FunctionExpression:
      case K.FunctionDeclaration:
      case K.MethodDeclaration: {
        const fn = node as ts.FunctionLikeDeclaration;
        if (fn.modifiers?.some((m) => m.kind === K.AsyncKeyword)) refuse('async', 'async functions are outside subset v1', fn);
        if (fn.asteriskToken) refuse('async', 'generators are outside subset v1', fn);
        if (fn.typeParameters && fn.typeParameters.length > 0) refuse('generic', 'generic functions are outside subset v1', fn.typeParameters[0]!);
        break;
      }
      case K.VariableDeclaration: {
        const d = node as ts.VariableDeclaration;
        const init = d.initializer ? unparen(d.initializer) : undefined;
        if (!d.type && init && ts.isArrayLiteralExpression(init) && init.elements.length === 0)
          refuse('missing-annotation', `annotate the type of \`${d.name.getText(sf)}\` (TypeScript cannot infer the element type of an empty array)`, d);
        break;
      }
      case K.IndexSignature:
        refuse('dictionary', 'index signatures (dictionary objects) are outside subset v1', node);
      case K.TypeReference: {
        const tr = node as ts.TypeReferenceNode;
        const name = ts.isIdentifier(tr.typeName) ? tr.typeName.text : tr.typeName.right.text;
        if (name === 'Record') refuse('dictionary', 'Record<K, V> (dictionary objects) is outside subset v1', node);
        const hit = GLOBAL_CODES[name];
        if (hit && (hit[0] === 'map-set' || hit[0] === 'date' || hit[0] === 'regex' || hit[0] === 'async')) refuse(hit[0], hit[1], node);
        if (name === 'ReadonlyMap' || name === 'ReadonlySet') refuse('map-set', `${name} is outside subset v1`, node);
        break;
      }
      case K.MappedType:
        refuse('dictionary', 'mapped types (dictionary objects) are outside subset v1', node);
      default:
        break;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}

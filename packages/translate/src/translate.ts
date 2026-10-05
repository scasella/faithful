/**
 * The translator API. Phases, in the order refusals are reported ("the first, most fundamental refusal wins"):
 *   1. locate the function            -> not-found
 *  1b. module scan                    -> unsupported-syntax (a top-level statement that runs code at load time)
 *   2. signature                      -> async, generic, this, missing-annotation, unsupported-type and the type codes
 *                                        (dictionary, map-set, date, regex), parameters left to right, then the return
 *   3. feature scan of the body       -> regex, date, map-set, nan, io, random, async, generic, bitwise, this, float,
 *                                        non-bmp, dictionary: first offending node in source order
 *   4. TypeScript errors in the function -> unsupported-syntax ("does not type-check")
 *   5. lowering to IR                 -> unsupported-syntax, unsupported-library, unsupported-type, missing-annotation,
 *                                        mutable-capture, no-termination-measure (source order, loops checked at their
 *                                        header before their body)
 */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import type { Param, Precondition, RefusalCode, RefusalStats, Translation, TranslationResult, Ty } from './contracts.js';
import { emitProgram, leanPred, recordsMap, tsPred } from './emit.js';
import { instrument } from './instrument.js';
import { MAX_RECURSION_DEPTH, MAX_STRING_LENGTH, type IrProgram } from './ir.js';
import { Lowerer } from './lower.js';
import { loadProgram, parseOnly } from './program.js';
import { scanModule } from './module.js';
import { scanFeatures } from './scan.js';
import { RefuseError, Records, TS_FILE_DIRECTIVE, findCommentMatching, findLineDirectiveFor, leanIdent, mapType, refuse, spanOf, tyMentions } from './types.js';

export const REFUSAL_CODES: RefusalCode[] = [
  'float', 'regex', 'date', 'map-set', 'dictionary', 'nan', 'io', 'random', 'async', 'generic', 'bitwise', 'this',
  'mutable-capture', 'no-termination-measure', 'unsupported-type', 'unsupported-syntax', 'unsupported-library',
  'missing-annotation', 'non-bmp', 'not-found',
];

export function sha256Text(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

type FnNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

interface Located {
  fn: FnNode;
  statement: ts.FunctionDeclaration | ts.VariableStatement;
  nameNode: ts.Identifier;
  exported: boolean;
  symbol: ts.Symbol | undefined;
}

function isExported(s: ts.Statement): boolean {
  return (ts.getCombinedModifierFlags(s as unknown as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function topLevelFunctions(sf: ts.SourceFile): Array<Omit<Located, 'symbol'>> {
  const out: Array<Omit<Located, 'symbol'>> = [];
  const exportedNames = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause) && !s.moduleSpecifier)
      for (const el of s.exportClause.elements) exportedNames.add((el.propertyName ?? el.name).text);
  }
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) {
      out.push({ fn: s, statement: s, nameNode: s.name, exported: isExported(s) || exportedNames.has(s.name.text) });
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const init = d.initializer ? skipParens(d.initializer) : undefined;
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
          out.push({ fn: init, statement: s, nameNode: d.name, exported: isExported(s) || exportedNames.has(d.name.text) });
      }
    }
  }
  return out;
}

function skipParens(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/** All top-level functions of a file, for the UI's file picker. `line` is 1-based. */
export function listExportedFunctions(source: string): Array<{ name: string; line: number; hasJsDoc: boolean; exported: boolean }> {
  const sf = parseOnly(source);
  return topLevelFunctions(sf).map((f) => ({
    name: f.nameNode.text,
    line: sf.getLineAndCharacterOfPosition(f.statement.getStart(sf)).line + 1,
    hasJsDoc: ts.getJSDocCommentsAndTags(f.statement).length > 0,
    exported: f.exported,
  }));
}

export function refusalStats(results: TranslationResult[]): RefusalStats {
  const s = Object.fromEntries(REFUSAL_CODES.map((c) => [c, 0])) as RefusalStats;
  for (const r of results) if (!r.ok) s[r.refusal.code]++;
  return s;
}

export interface TranslationWithIr {
  result: TranslationResult;
  /** The IR the Lean model was emitted from (present when `result.ok`). For the SMT encoder. */
  ir?: IrProgram;
}

const cache = new Map<string, TranslationWithIr>();
const CACHE_MAX = 64;

/** Translate the exported function `fnName` of `source` to a Lean model, or refuse with a reason and a span. */
export function translate(source: string, fnName: string): TranslationResult {
  return translateWithIr(source, fnName).result;
}

export function translateWithIr(source: string, fnName: string): TranslationWithIr {
  const key = `${fnName}\u0000${source}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = doTranslate(source, fnName);
  cache.set(key, r);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return r;
}

function doTranslate(source: string, fnName: string): TranslationWithIr {
  const { program, checker, sf } = loadProgram(source);
  try {
    return translateIn(program, checker, sf, fnName);
  } catch (e) {
    if (e instanceof RefuseError) return { result: { ok: false, fnName, refusal: { code: e.code, reason: e.reason, span: spanOf(e.at, sf) } } };
    throw e;
  }
}

function translateIn(program: ts.Program, checker: ts.TypeChecker, sf: ts.SourceFile, fnName: string): TranslationWithIr {
  // 1. locate
  const all = topLevelFunctions(sf).filter((f) => f.nameNode.text === fnName);
  if (all.length === 0) refuse('not-found', `no top-level function named \`${fnName}\` in this file`, { start: 0, end: 0 });
  const found = all[0]!;
  if (!found.exported) refuse('not-found', `\`${fnName}\` is not exported`, found.nameNode);
  if (all.length > 1 || (ts.isFunctionDeclaration(found.fn) && !found.fn.body))
    refuse('unsupported-syntax', 'overloaded functions are outside subset v1', found.nameNode);
  const fn = found.fn;
  if (fnName === '__faithful')
    refuse('unsupported-syntax', '`__faithful` is reserved: it names the range-check runtime that the instrumented original runs beside', found.nameNode);
  const symbol = checker.getSymbolAtLocation(found.nameNode);
  if (ts.isVariableStatement(found.statement) && !(found.statement.declarationList.flags & ts.NodeFlags.Const))
    refuse('mutable-capture', 'the function is bound with `let`/`var`; declare it with `const` or `function`', found.nameNode);

  // 1b. module scan: top-level statements that run code at load time (red-team round 2, mathFloorPatched)
  scanModule(sf);

  // 2. signature
  if (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) refuse('async', 'async functions are outside subset v1', fn.modifiers.find((m) => m.kind === ts.SyntaxKind.AsyncKeyword)!);
  if (fn.asteriskToken) refuse('async', 'generator functions are outside subset v1', fn.asteriskToken);
  if (fn.typeParameters?.length) refuse('generic', 'generic functions are outside subset v1', fn.typeParameters[0]!);
  const records = new Records(leanIdent(fnName));
  const params: Array<{ sym: ts.Symbol; name: string; ty: Ty }> = [];
  for (const p of fn.parameters) {
    if (ts.isIdentifier(p.name) && p.name.text === 'this') refuse('this', 'a `this` parameter is outside subset v1', p);
    if (!ts.isIdentifier(p.name)) refuse('unsupported-syntax', 'destructuring parameters are outside subset v1', p.name);
    if (p.dotDotDotToken) refuse('unsupported-syntax', 'rest parameters are outside subset v1', p);
    if (p.initializer) refuse('unsupported-syntax', 'default parameter values are outside subset v1', p.initializer);
    if (p.questionToken) refuse('unsupported-syntax', 'optional parameters are outside subset v1', p);
    if (!p.type) refuse('missing-annotation', `parameter \`${p.name.text}\` needs a type annotation`, p);
    const ty = mapType(checker, checker.getTypeFromTypeNode(p.type), p.type, records, { allowOption: false, what: `parameter \`${p.name.text}\`` });
    params.push({ sym: checker.getSymbolAtLocation(p.name)!, name: p.name.text, ty });
  }
  if (!fn.type) refuse('missing-annotation', 'the return type needs an annotation', found.nameNode);
  const ret = mapType(checker, checker.getTypeFromTypeNode(fn.type), fn.type, records, { allowOption: true, what: 'the return type' });

  // 3. feature scan
  if (fn.body) scanFeatures(fn.body, checker, sf);

  // 4. TypeScript errors. The lowering trusts the checker's verdict (string `-`, assignment to a `const`, duplicate
  // keys, ... are refused only through it), so a comment directive that hides diagnostics makes this check unsound
  // (red-team round 4, r4TsIgnore* / r4TsExpectError* / r4TsNocheck*): refused before looking at the diagnostics.
  const nocheck = findCommentMatching(sf, sf, TS_FILE_DIRECTIVE);
  if (nocheck)
    refuse('unsupported-syntax', 'the file has a `@ts-nocheck` comment, which hides the TypeScript errors the translator relies on; remove it', nocheck);
  const lineDirective = findLineDirectiveFor(sf, found.statement);
  if (lineDirective)
    refuse('unsupported-syntax', 'a `@ts-ignore` / `@ts-expect-error` comment hides TypeScript errors the translator relies on; remove it and fix the error', lineDirective);
  const allDiags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].filter(
    (d) => d.category === ts.DiagnosticCategory.Error && d.start !== undefined,
  );
  const diags = allDiags.filter((d) => d.start! >= found.statement.pos && d.start! < found.statement.end);
  if (diags.length > 0) {
    const d = diags[0]!;
    refuse('unsupported-syntax', `the function does not type-check: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`, {
      start: d.start!,
      end: d.start! + (d.length ?? 0),
    });
  }

  // 5. lowering
  const lowerer = new Lowerer(checker, sf, fn, symbol, fnName, records, allDiags);
  const low = lowerer.lower(params, ret);
  const ir = low.program;

  // preconditions
  const c = { records: recordsMap(ir.records) };
  const conj = (xs: Array<string | null>): string | null => {
    const ys = xs.filter((x): x is string => !!x);
    return ys.length ? ys.map((y) => `(${y})`).join(' && ') : null;
  };
  const leanInt = conj(ir.params.map((p) => leanPred(p.ty as Ty, p.name, 'int', c)));
  const leanBmp = conj(ir.params.map((p) => leanPred(p.ty as Ty, p.name, 'string', c)));
  const emitted = emitProgram(ir, { usesAscii: low.usesAscii, pre: { intBound: leanInt, bmp: leanBmp } });
  const argNames = ir.params.map((p) => ` ${p.name}`).join('');
  const preconditions: Precondition[] = [];
  if (leanInt)
    preconditions.push({
      id: 'int-bound',
      kind: 'int-bound',
      words: 'Every number in the arguments is a whole number between -2^53 and 2^53.',
      lean: leanInt,
      ts: conj(params.map((p) => tsPred(p.ty, p.name, 'int')))!,
    });
  if (leanBmp)
    preconditions.push({
      id: 'bmp',
      kind: 'bmp',
      words: 'Every string in the arguments is Basic Multilingual Plane text: no emoji or other characters written as two UTF-16 units, and no lone surrogates.',
      lean: leanBmp,
      ts: conj(params.map((p) => tsPred(p.ty, p.name, 'string')))!,
    });
  preconditions.push({
    id: 'range-ok',
    kind: 'range-ok',
    words:
      `Running the original stays inside the model: every intermediate number is a whole number within ±2^53, every array index, string index and charCodeAt position is in range, no division or % is by zero, and no string built by concatenation or join is longer than ${MAX_STRING_LENGTH} UTF-16 units (JavaScript engines reject very long strings)` +
      (low.recursive ? `, and at most ${MAX_RECURSION_DEPTH} calls of the function are active at once (recursion depth; deeper recursion can exhaust the JavaScript stack).` : '.'),
    lean: `${emitted.names.rangeOk}${argNames}`,
  });
  if (low.usesAscii)
    preconditions.push({
      id: 'ascii',
      kind: 'ascii',
      words: 'Every string that reaches toLowerCase/toUpperCase is ASCII (the model changes the case of ASCII letters only).',
      lean: `${emitted.names.asciiOk}${argNames}`,
    });

  const notes = [...low.notes];
  if (tyMentions(ret, 'int') || params.some((p) => tyMentions(p.ty, 'int'))) notes.unshift('integer semantics: number is modeled as Int; intermediates must stay within ±2^53 (range-ok)');
  if (tyMentions(ret, 'string') || params.some((p) => tyMentions(p.ty, 'string'))) notes.unshift('UTF-16 gap: strings are modeled as BMP text (bmp precondition)');

  const instrumentedTs = instrument({ sf, fnStatement: found.statement, moduleConsts: low.moduleConsts, comparators: low.comparators, checked: low.checked });
  const fnText = sf.text.slice(found.statement.getStart(sf), found.statement.end);
  // The plain original as a self-contained unit: the module constants it reads (verbatim), then the function.
  const plainTs = [...low.moduleConsts.map((s) => sf.text.slice(s.getStart(sf), s.end)), fnText].join('\n') + '\n';
  const outParams: Param[] = params.map((p) => ({ name: p.name, ty: p.ty }));
  const translation: Translation = {
    ok: true,
    fnName,
    params: outParams,
    ret,
    canThrow: ir.throws,
    throwSites: low.throwSites,
    lean: {
      source: emitted.text,
      names: emitted.names.asciiOk !== null ? { original: emitted.names.original, rangeOk: emitted.names.rangeOk, pre: emitted.names.pre } : { original: emitted.names.original, rangeOk: emitted.names.rangeOk, pre: emitted.names.pre },
      paramTypes: emitted.paramTypes,
      paramNames: ir.params.map((p) => p.name),
      retType: emitted.retType,
      hash: sha256Text(emitted.text),
      records: ir.records.map((r) => ({ key: r.key, name: r.name, fields: r.fields.map((f) => ({ name: f.name, lean: f.lean, ty: f.ty })) })),
    },
    preconditions,
    source: { text: fnText, hash: sha256Text(fnText) },
    plainTs,
    instrumentedTs,
    notes,
  };
  return { result: translation, ir };
}

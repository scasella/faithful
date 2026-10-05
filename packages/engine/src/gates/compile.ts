/**
 * Compile gate: type-check a candidate translation unit with the real TypeScript compiler, in memory.
 *
 * Options: strict (includes noImplicitAny), target ES2022, lib es2022 only, no @types (so `process`, `require`,
 * `fetch`, `console`, DOM names are undeclared and fail here already). The candidate must export a function named
 * `fnName`, must not import anything, and, when an original is given, the function must have the same parameter types
 * (in order) and return type. Types are compared structurally: aliases and interfaces are expanded and record fields
 * sorted, so `type P = {x: number}` and an inline `{ x: number }` print the same canonical text.
 *
 * Idea of the lazily-built, cached compiler state adapted from scasella/undefined src/gates/compile.ts (MIT); the
 * implementation here is new (Node file system host, two-file program, structural signature check).
 */
import ts from 'typescript';
import { moduleProblems } from '../sandbox/source.js';

export interface CompileDiagnostic {
  file: 'candidate' | 'original';
  /** 1-based. */
  line: number;
  column: number;
  message: string;
  /** TypeScript diagnostic code; 0 for gate-level (non-tsc) problems. */
  code: number;
  category: 'error' | 'warning';
}

export interface Signature {
  params: Array<{ name: string; type: string; optional: boolean }>;
  ret: string;
}

export interface CompileGateResult {
  gate: 'compile';
  ok: boolean;
  /** Errors and warnings, candidate first; gate-level problems carry code 0. */
  diagnostics: CompileDiagnostic[];
  /** Canonical signature of the candidate's exported function, when found. */
  signature?: Signature;
  /** Canonical signature of the original's exported function, when an original was given and the function found. */
  originalSignature?: Signature;
  ms: number;
}

export interface CompileGateInput {
  /** Full candidate translation unit (TypeScript). */
  candidate: string;
  fnName: string;
  /** The original translation unit; when given, the signatures must match. */
  original?: string;
}

const CANDIDATE = '/faithful/candidate.ts';
const ORIGINAL = '/faithful/original.ts';

export const COMPILE_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noImplicitAny: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts'],
  types: [],
  noEmit: true,
  skipLibCheck: true,
  isolatedModules: true,
  noFallthroughCasesInSwitch: true,
};

const libCache = new Map<string, ts.SourceFile>();
let oldProgram: ts.Program | undefined;

function makeHost(files: Map<string, string>): ts.CompilerHost {
  const base = ts.createCompilerHost(COMPILE_OPTIONS, true);
  return {
    ...base,
    getSourceFile(fileName, languageVersion, onError) {
      const text = files.get(fileName);
      if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS);
      const cached = libCache.get(fileName);
      if (cached) return cached;
      const sf = base.getSourceFile(fileName, languageVersion, onError);
      if (sf && /[\\/]lib\.[^\\/]*\.d\.ts$/.test(fileName)) libCache.set(fileName, sf);
      return sf;
    },
    fileExists: (f) => files.has(f) || base.fileExists(f),
    readFile: (f) => files.get(f) ?? base.readFile(f),
    writeFile: () => undefined,
  };
}

/** The exported function declaration `fnName` (`export function`, `export default function`, or `export { fnName }`). */
function findExported(sf: ts.SourceFile, fnName: string): ts.FunctionDeclaration | null {
  let decl: ts.FunctionDeclaration | null = null;
  let exportedByList = false;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === fnName && st.body) {
      decl = st;
      const mods = ts.getModifiers(st) ?? [];
      if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return st;
    }
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      if (st.exportClause.elements.some((e) => e.name.text === fnName && (e.propertyName?.text ?? e.name.text) === fnName)) {
        exportedByList = true;
      }
    }
  }
  return exportedByList ? decl : null;
}

/** Canonical structural text of a type: aliases expanded, record fields sorted by name, union members sorted. */
export function canonicalType(checker: ts.TypeChecker, t: ts.Type, depth = 0): string {
  if (depth > 20) return '<deep>';
  const f = t.flags;
  if (f & ts.TypeFlags.Number) return 'number';
  if (f & ts.TypeFlags.String) return 'string';
  if (f & ts.TypeFlags.Boolean) return 'boolean';
  if (f & ts.TypeFlags.Null) return 'null';
  if (f & ts.TypeFlags.Undefined) return 'undefined';
  if (f & ts.TypeFlags.Void) return 'void';
  if (f & ts.TypeFlags.Never) return 'never';
  if (f & ts.TypeFlags.Any) return 'any';
  if (f & ts.TypeFlags.Unknown) return 'unknown';
  if (f & ts.TypeFlags.BigInt) return 'bigint';
  if (f & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral)) {
    return checker.typeToString(t);
  }
  if (t.isUnion()) {
    // `boolean` is `true | false` internally: fold it back.
    const parts = t.types.map((x) => canonicalType(checker, x, depth + 1));
    const set = new Set(parts);
    if (set.has('true') && set.has('false')) {
      set.delete('true');
      set.delete('false');
      set.add('boolean');
    }
    return [...set].sort().join(' | ');
  }
  if (t.isIntersection()) return t.types.map((x) => canonicalType(checker, x, depth + 1)).sort().join(' & ');
  if (checker.isTupleType(t)) {
    const args = checker.getTypeArguments(t as ts.TypeReference);
    return `[${args.map((x) => canonicalType(checker, x, depth + 1)).join(', ')}]`;
  }
  if (checker.isArrayType(t)) {
    const [elem] = checker.getTypeArguments(t as ts.TypeReference);
    const ro = (t as ts.TypeReference).target?.symbol?.name === 'ReadonlyArray' ? 'readonly ' : '';
    return `${ro}${elem ? canonicalType(checker, elem, depth + 1) : 'unknown'}[]`;
  }
  if (f & ts.TypeFlags.Object) {
    const calls = t.getCallSignatures();
    if (calls.length > 0 && t.getProperties().length === 0) return checker.typeToString(t);
    const sym = t.getSymbol();
    // Built-in classes (Map, Date, RegExp ...) by name; plain records structurally.
    if (sym && (sym.flags & ts.SymbolFlags.Class)) return checker.typeToString(t);
    const props = checker.getPropertiesOfType(t).map((p) => {
      const pt = checker.getTypeOfSymbol(p);
      const opt = p.flags & ts.SymbolFlags.Optional ? '?' : '';
      return `${p.name}${opt}: ${canonicalType(checker, pt, depth + 1)}`;
    });
    const idx = checker.getIndexInfosOfType(t).map(
      (i) => `[k: ${canonicalType(checker, i.keyType, depth + 1)}]: ${canonicalType(checker, i.type, depth + 1)}`,
    );
    return `{ ${[...props.sort(), ...idx.sort()].join('; ')} }`;
  }
  return checker.typeToString(t);
}

function signatureOf(checker: ts.TypeChecker, fn: ts.FunctionDeclaration): Signature | null {
  const sig = checker.getSignatureFromDeclaration(fn);
  if (!sig) return null;
  const params = fn.parameters.map((p, i) => {
    const sym = sig.getParameters()[i];
    const type = sym ? checker.getTypeOfSymbolAtLocation(sym, p) : checker.getTypeAtLocation(p);
    const optional = p.questionToken !== undefined || p.initializer !== undefined;
    // With strictNullChecks an optional parameter's type includes `undefined`; the flag carries that information.
    let text = canonicalType(checker, optional ? checker.getNonNullableType(type) : type);
    if (p.dotDotDotToken) text = `...${text}`;
    return { name: p.name.getText(), type: text, optional };
  });
  return { params, ret: canonicalType(checker, checker.getReturnTypeOfSignature(sig)) };
}

function describe(s: Signature): string {
  return `(${s.params.map((p) => `${p.type}${p.optional ? ' (optional)' : ''}`).join(', ')}) => ${s.ret}`;
}

export function compileGate(input: CompileGateInput): CompileGateResult {
  const t0 = performance.now();
  const files = new Map<string, string>([[CANDIDATE, input.candidate]]);
  if (input.original !== undefined) files.set(ORIGINAL, input.original);
  const host = makeHost(files);
  const program = ts.createProgram([...files.keys()], COMPILE_OPTIONS, host, oldProgram);
  oldProgram = program;
  const checker = program.getTypeChecker();
  const diagnostics: CompileDiagnostic[] = [];

  const pos = (sf: ts.SourceFile | undefined, start: number | undefined): { line: number; column: number } => {
    if (!sf || start === undefined) return { line: 1, column: 1 };
    const lc = sf.getLineAndCharacterOfPosition(start);
    return { line: lc.line + 1, column: lc.character + 1 };
  };
  const gateError = (file: 'candidate' | 'original', sf: ts.SourceFile | undefined, start: number | undefined, message: string): void => {
    diagnostics.push({ file, ...pos(sf, start), message, code: 0, category: 'error' });
  };

  const cand = program.getSourceFile(CANDIDATE)!;
  const orig = input.original !== undefined ? program.getSourceFile(ORIGINAL) : undefined;

  for (const [which, sf] of [['candidate', cand], ['original', orig]] as const) {
    if (!sf) continue;
    for (const p of moduleProblems(sf)) gateError(which, sf, p.pos, p.message);
    const ds = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    for (const d of ds) {
      if (d.category !== ts.DiagnosticCategory.Error && d.category !== ts.DiagnosticCategory.Warning) continue;
      diagnostics.push({
        file: which,
        ...pos(d.file, d.start),
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        code: d.code,
        category: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
      });
    }
  }
  for (const d of program.getGlobalDiagnostics()) {
    diagnostics.push({ file: 'candidate', line: 1, column: 1, message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), code: d.code, category: 'error' });
  }

  let signature: Signature | undefined;
  let originalSignature: Signature | undefined;
  const fn = findExported(cand, input.fnName);
  if (!fn) {
    gateError('candidate', cand, undefined, `the candidate does not export a function named '${input.fnName}'`);
  } else {
    signature = signatureOf(checker, fn) ?? undefined;
  }
  if (orig) {
    const ofn = findExported(orig, input.fnName);
    if (!ofn) gateError('original', orig, undefined, `the original does not export a function named '${input.fnName}'`);
    else originalSignature = signatureOf(checker, ofn) ?? undefined;
  }
  if (signature && originalSignature) {
    const a = signature;
    const b = originalSignature;
    const at = fn ? fn.getStart(cand) : undefined;
    if (a.params.length !== b.params.length) {
      gateError('candidate', cand, at, `'${input.fnName}' takes ${a.params.length} parameter(s); the original takes ${b.params.length}: candidate ${describe(a)}, original ${describe(b)}`);
    } else {
      for (let i = 0; i < a.params.length; i++) {
        const pa = a.params[i]!;
        const pb = b.params[i]!;
        if (pa.type !== pb.type || pa.optional !== pb.optional) {
          gateError('candidate', cand, fn?.parameters[i]?.getStart(cand), `parameter ${i + 1} ('${pa.name}') has type ${pa.type}${pa.optional ? ' (optional)' : ''}; the original's has ${pb.type}${pb.optional ? ' (optional)' : ''}`);
        }
      }
    }
    if (a.ret !== b.ret) {
      gateError('candidate', cand, fn?.type?.getStart(cand) ?? at, `'${input.fnName}' returns ${a.ret}; the original returns ${b.ret}`);
    }
  }

  diagnostics.sort((x, y) => (x.file === y.file ? 0 : x.file === 'candidate' ? -1 : 1));
  const ok = !diagnostics.some((d) => d.category === 'error');
  const result: CompileGateResult = { gate: 'compile', ok, diagnostics, ms: performance.now() - t0 };
  if (signature) result.signature = signature;
  if (originalSignature) result.originalSignature = originalSignature;
  return result;
}

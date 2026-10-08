/**
 * Adapted from scasella/undefined packages/engine/src/mutation/mutate.ts, MIT, (c) 2026 Stephen Casella; changes: mutates the
 * TypeScript source of one named function (not compiled JS) with a type checker at hand, so `+` on strings is not
 * swapped and "return a different variable" only substitutes a variable whose type fits the declared return type;
 * added kinds remove-statement, swap-branches, loop-bound and return-variable, dropped return-undefined (outside the
 * subset's return types); nodes inside type annotations are never mutated; "parses" is `prepareSource` (the same
 * transpilation the sandbox applies); line/column are 1-based positions in the given source; Node only (static
 * `typescript` import). The seeded round-robin selection over kinds and the stillborn accounting are the reference's.
 *
 * A mutant is a "broken copy" of the original: the original text with exactly one span replaced. Every candidate site
 * is found by walking the AST of the target function's body; mutants are deduplicated by resulting text.
 *
 * Selection: all distinct candidates are enumerated, shuffled per kind with a seeded PRNG, and drawn round-robin across
 * kinds (kind order also seeded) until `max` mutants that pass `prepareSource` are chosen. A drawn candidate that does
 * not pass is counted in `stillborn` and replaced by the next candidate of the same kind.
 */
import ts from 'typescript';
import { prepareSource } from '../sandbox/source.js';
import { COMPILE_OPTIONS, canonicalType } from '../gates/compile.js';
import { mulberry32, shuffle } from '../benchmark/rng.js';

export type MutationKind =
  | 'arithmetic' // + <-> - (numbers only), * -> +, / -> *, % -> *, and += <-> -=, *= -> +=
  | 'comparison' // < -> <=, <= -> <, > -> >=, >= -> > (off by one)
  | 'equality' // === <-> !==, == <-> !=
  | 'logical' // && <-> ||
  | 'constant' // integer literal n -> n + 1, n -> n - 1 (0 <-> 1 first)
  | 'boolean' // true <-> false
  | 'remove-not' // !x -> x
  | 'negate-condition' // if / while / for / ternary condition c -> !(c)
  | 'swap-branches' // if (c) A else B -> if (c) B else A; c ? a : b -> c ? b : a
  | 'loop-bound' // for (...; i < n; ...) -> i < (n) + 1 and i < (n) - 1
  | 'remove-statement' // an expression, if, loop or throw statement, or a non-final return, deleted
  | 'return-variable'; // return e -> return v, v another in-scope variable whose type fits the return type

/** Fixed enumeration order of kinds (the seeded shuffle permutes it per seed). */
export const MUTATION_KINDS: readonly MutationKind[] = [
  'arithmetic',
  'comparison',
  'equality',
  'logical',
  'constant',
  'boolean',
  'remove-not',
  'negate-condition',
  'swap-branches',
  'loop-bound',
  'remove-statement',
  'return-variable',
];

export interface Mutant {
  /** Stable for a given source: kind, line:column of the span, and a variant suffix where one site has several. */
  id: string;
  kind: MutationKind;
  /** 1-based line and column of the replaced span in the given source. */
  line: number;
  column: number;
  /** Exact replaced text of the source. */
  original: string;
  /** Exact text spliced in its place. */
  mutated: string;
  /** The whole mutated source. */
  source: string;
}

export interface GeneratedMutants {
  mutants: Mutant[];
  /** Drawn candidates that `prepareSource` rejected (never returned, never run, never caught). */
  stillborn: number;
  /** The rejected candidates themselves (no `source`). */
  stillbornMutants: Array<Omit<Mutant, 'source'>>;
  /** Distinct candidate mutants found (after removing duplicates and no-ops). */
  sites: number;
  /** Candidates per kind, before selection. */
  sitesByKind: Partial<Record<MutationKind, number>>;
}

interface Candidate {
  id: string;
  kind: MutationKind;
  line: number;
  column: number;
  start: number;
  end: number;
  original: string;
  mutated: string;
}

const ARITHMETIC: Partial<Record<string, string>> = {
  '+': '-',
  '-': '+',
  '*': '+',
  '/': '*',
  '%': '*',
  '+=': '-=',
  '-=': '+=',
  '*=': '+=',
};
const COMPARISON: Partial<Record<string, string>> = { '<': '<=', '<=': '<', '>': '>=', '>=': '>' };
const EQUALITY: Partial<Record<string, string>> = { '===': '!==', '!==': '===', '==': '!=', '!=': '==' };
const LOGICAL: Partial<Record<string, string>> = { '&&': '||', '||': '&&' };

export const UNIT_FILE = '/faithful/mutation-unit.ts';
const FILE = UNIT_FILE;
const libCache = new Map<string, ts.SourceFile>();

/** An in-memory program over `source` (lib files cached across calls). */
export function makeProgram(source: string): ts.Program {
  const base = ts.createCompilerHost(COMPILE_OPTIONS, true);
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile(fileName, languageVersion, onError) {
      if (fileName === FILE) return ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS);
      const cached = libCache.get(fileName);
      if (cached) return cached;
      const sf = base.getSourceFile(fileName, languageVersion, onError);
      if (sf && /[\\/]lib\.[^\\/]*\.d\.ts$/.test(fileName)) libCache.set(fileName, sf);
      return sf;
    },
    fileExists: (f) => f === FILE || base.fileExists(f),
    readFile: (f) => (f === FILE ? source : base.readFile(f)),
    writeFile: () => undefined,
  };
  return ts.createProgram({ rootNames: [FILE], options: COMPILE_OPTIONS, host });
}

/** The top-level function declaration named `fnName` (exported or not). */
export function findFunction(sf: ts.SourceFile, fnName: string): ts.FunctionDeclaration | null {
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === fnName && st.body) return st;
  }
  return null;
}

function splice(src: string, c: { start: number; end: number; mutated: string }): string {
  return src.slice(0, c.start) + c.mutated + src.slice(c.end);
}

/** Enumerates every candidate mutation in the body of function `fnName` of `source` (document order). */
export function enumerateCandidates(source: string, fnName: string): Candidate[] {
  const program = makeProgram(source);
  const sf = program.getSourceFile(FILE)!;
  const checker = program.getTypeChecker();
  const fn = findFunction(sf, fnName);
  if (!fn || !fn.body) return [];
  const body = fn.body;
  const out: Candidate[] = [];

  const add = (kind: MutationKind, start: number, end: number, mutated: string, variant = ''): void => {
    const original = source.slice(start, end);
    if (original === mutated) return;
    const lc = sf.getLineAndCharacterOfPosition(start);
    out.push({ id: `${kind}@${lc.line + 1}:${lc.character + 1}${variant}`, kind, line: lc.line + 1, column: lc.character + 1, start, end, original, mutated });
  };
  const addNode = (kind: MutationKind, node: ts.Node, mutated: string, variant = ''): void =>
    add(kind, node.getStart(sf), node.end, mutated, variant);
  const text = (n: ts.Node): string => n.getText(sf);

  const isStringish = (e: ts.Expression): boolean => {
    const t = checker.getTypeAtLocation(e);
    const c = canonicalType(checker, t);
    return c !== 'number' && !/^-?\d+$/.test(c);
  };

  const negate = (cond: ts.Expression | undefined): void => {
    if (!cond) return;
    // `!x` as a condition is already covered by remove-not; `!(!x)` would duplicate it.
    if (ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken) return;
    addNode('negate-condition', cond, `!(${text(cond)})`);
  };

  // Declared return type of the function, for return-variable.
  const sig = checker.getSignatureFromDeclaration(fn);
  const retType = sig ? checker.getReturnTypeOfSignature(sig) : undefined;
  const ownDecl = (d: ts.Declaration): boolean => d.getStart(sf) >= fn.getStart(sf) && d.end <= fn.end;

  const returnVariable = (ret: ts.ReturnStatement): void => {
    const e = ret.expression;
    if (!e || !retType) return;
    const syms = checker.getSymbolsInScope(ret, ts.SymbolFlags.Variable);
    const names: string[] = [];
    for (const s of syms) {
      const d = s.valueDeclaration;
      if (!d || !ownDecl(d)) continue;
      if (!(ts.isParameter(d) || ts.isVariableDeclaration(d))) continue;
      // Declared before the return statement (no temporal dead zone at run time).
      if (d.end > ret.getStart(sf)) continue;
      const t = checker.getTypeOfSymbolAtLocation(s, ret);
      if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) continue;
      if (!checker.isTypeAssignableTo(t, retType)) continue;
      if (s.name === text(e)) continue;
      names.push(s.name);
    }
    names.sort();
    for (const n of names) addNode('return-variable', e, n, `=${n}`);
  };

  const isRemovable = (st: ts.Statement, parent: ts.Block): boolean => {
    if (ts.isExpressionStatement(st) || ts.isIfStatement(st) || ts.isThrowStatement(st)) return true;
    if (ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)) return true;
    if (ts.isReturnStatement(st)) {
      // The function's final return: removing it makes every input return undefined; not a test of anything.
      return !(parent === body && st === body.statements[body.statements.length - 1]);
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return; // never mutate type annotations
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken;
      const opText = op.getText(sf);
      const swap = (kind: MutationKind, table: Partial<Record<string, string>>): void => {
        const to = table[opText];
        if (to !== undefined) add(kind, op.getStart(sf), op.end, to);
      };
      const stringy = (opText === '+' || opText === '+=') && (isStringish(node.left) || isStringish(node.right));
      if (!stringy) swap('arithmetic', ARITHMETIC);
      swap('comparison', COMPARISON);
      swap('equality', EQUALITY);
      swap('logical', LOGICAL);
    } else if (ts.isNumericLiteral(node)) {
      const t = node.getText(sf);
      if (/^(0|[1-9][0-9]*)$/.test(t)) {
        const n = BigInt(t);
        if (n === 0n) addNode('constant', node, '1');
        if (n === 1n) addNode('constant', node, '0');
        addNode('constant', node, `${n + 1n}`, '+1');
        if (n > 0n) addNode('constant', node, `${n - 1n}`, '-1');
        else addNode('constant', node, '(-1)', '-1');
      }
    } else if (node.kind === ts.SyntaxKind.TrueKeyword) {
      addNode('boolean', node, 'false');
    } else if (node.kind === ts.SyntaxKind.FalseKeyword) {
      addNode('boolean', node, 'true');
    } else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      addNode('remove-not', node, text(node.operand));
    } else if (ts.isReturnStatement(node)) {
      returnVariable(node);
    }

    if (ts.isIfStatement(node)) {
      negate(node.expression);
      if (node.elseStatement) {
        addNode('swap-branches', node, `if (${text(node.expression)}) { ${text(node.elseStatement)} } else { ${text(node.thenStatement)} }`);
      }
    } else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      negate(node.expression);
    } else if (ts.isForStatement(node)) {
      negate(node.condition);
      const c = node.condition;
      if (c && ts.isBinaryExpression(c) && COMPARISON[c.operatorToken.getText(sf)] !== undefined) {
        addNode('loop-bound', c.right, `(${text(c.right)}) + 1`, '+1');
        addNode('loop-bound', c.right, `(${text(c.right)}) - 1`, '-1');
      }
    } else if (ts.isConditionalExpression(node)) {
      negate(node.condition);
      addNode('swap-branches', node, `${text(node.condition)} ? ${text(node.whenFalse)} : ${text(node.whenTrue)}`);
    }
    if (ts.isBlock(node)) {
      for (const st of node.statements) if (isRemovable(st, node)) addNode('remove-statement', st, '');
    }
    ts.forEachChild(node, visit);
  };
  visit(body);

  // Drop duplicates by resulting text (first in document order wins) and no-ops.
  const seen = new Set<string>([source]);
  return out.filter((c) => {
    const t = splice(source, c);
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

export function generateMutants(source: string, fnName: string, opts: { seed: number; max: number }): GeneratedMutants {
  const candidates = enumerateCandidates(source, fnName);
  const sitesByKind: Partial<Record<MutationKind, number>> = {};
  for (const c of candidates) sitesByKind[c.kind] = (sitesByKind[c.kind] ?? 0) + 1;
  const rand = mulberry32(opts.seed);
  const queues = new Map<MutationKind, Candidate[]>();
  for (const kind of shuffle([...MUTATION_KINDS], rand)) {
    const ofKind = candidates.filter((c) => c.kind === kind);
    if (ofKind.length > 0) queues.set(kind, shuffle(ofKind, rand));
  }
  const max = Math.max(0, Math.floor(opts.max));
  const mutants: Mutant[] = [];
  let stillborn = 0;
  const stillbornMutants: Array<Omit<Mutant, 'source'>> = [];
  while (mutants.length < max && queues.size > 0) {
    for (const [kind, queue] of [...queues]) {
      if (mutants.length >= max) break;
      while (queue.length > 0) {
        const c = queue.shift()!;
        const t = splice(source, c);
        if (!prepareSource(t).ok) {
          stillborn++;
          stillbornMutants.push({ id: c.id, kind: c.kind, line: c.line, column: c.column, original: c.original, mutated: c.mutated });
          continue;
        }
        mutants.push({ id: c.id, kind: c.kind, line: c.line, column: c.column, original: c.original, mutated: c.mutated, source: t });
        break;
      }
      if (queue.length === 0) queues.delete(kind);
    }
  }
  return { mutants, stillborn, stillbornMutants, sites: candidates.length, sitesByKind };
}

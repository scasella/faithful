/**
 * Candidate generation: the prompt (original, agreed spec in English and Lean, preconditions and carve-outs, the incumbent's
 * timing, the previous candidate's rejection) and AST helpers. The prompt never contains inputs from the differential tester
 * (a rejection may show ONE counterexample for the previous candidate, which is the point of the rejection).
 */
import ts from 'typescript';
import type { Outcome, Precondition, Val } from '@faithful/translate';
import type { Rejection } from '@faithful/session';

export const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string', description: 'The complete replacement TypeScript: the exported function with the same name, parameter names and types, and return type, plus any type aliases it needs.' },
    idea: { type: 'string', description: 'One or two sentences: what makes this faster.' },
  },
  required: ['source', 'idea'],
  additionalProperties: false,
} as const;

export interface PromptInput {
  fn: string;
  original: string;
  specEnglish: string;
  specLean: string;
  preconditions: Precondition[];
  carveOuts: Precondition[];
  incumbent: { source: string; timing: string };
  distribution: string;
  previous?: { source: string; rejection: Rejection } | null;
  round: number;
}

const showVal = (v: Val | Val[]): string => JSON.stringify(v);
const showOutcome = (o: Outcome): string => (o.tag === 'ok' ? showVal(o.value) : o.tag === 'throw' ? `throws "${o.message}"` : `${o.tag}${'detail' in o ? ` (${o.detail})` : ''}`);

export function describeRejection(r: Rejection): string {
  const lines = [`Rejected at the ${r.stage} stage: ${r.reason}`];
  if (r.counterexample) {
    lines.push(`Counterexample input: ${showVal(r.counterexample.input)}; the original returns ${showOutcome(r.counterexample.original)}, the candidate returned ${showOutcome(r.counterexample.candidate)}.`);
  }
  if (r.goal) lines.push(`Lean could not prove it; failing goal:\n${r.goal}`);
  return lines.join('\n');
}

export function buildCandidatePrompt(p: PromptInput): string {
  const pre = [...p.preconditions, ...p.carveOuts].map((c) => `- ${c.words}`).join('\n');
  return [
    `You are optimizing a TypeScript function for speed. Your replacement must do EXACTLY what the agreed specification says on every input that satisfies the preconditions; it will be checked by differential testing, a bounded SMT equivalence check and a Lean proof, and then benchmarked. A faster function that is wrong is rejected.`,
    '',
    `FUNCTION: ${p.fn}`,
    '',
    'ORIGINAL:',
    '```ts',
    p.original.trim(),
    '```',
    '',
    'AGREED SPECIFICATION (what the function must compute):',
    p.specEnglish.trim(),
    '```lean',
    p.specLean.trim(),
    '```',
    '',
    'PRECONDITIONS AND CARVE-OUTS (behavior outside them does not matter):',
    pre || '(none)',
    '',
    `CURRENT BEST (the incumbent) and its timing on the declared distribution (${p.distribution}): ${p.incumbent.timing}`,
    '```ts',
    p.incumbent.source.trim(),
    '```',
    ...(p.previous ? ['', 'YOUR PREVIOUS CANDIDATE:', '```ts', p.previous.source.trim(), '```', describeRejection(p.previous.rejection), 'Do not repeat this mistake.'] : []),
    '',
    'RULES: keep the exported name, parameter names and types, and return type. Pure code only: no I/O, no randomness, no globals, no mutation of the arguments. Use only plain TypeScript: numbers are integers, arrays, strings, records, loops, recursion, Math.floor/ceil/abs/min/max, array length/slice/concat/map/filter/reduce/indexOf/includes/sort and string length/charAt/charCodeAt/slice/indexOf/split/join. Stay inside +-2^53 for every intermediate value on valid inputs.',
    `Return JSON with \`source\` (the complete replacement) and \`idea\` (why it is faster). Round ${p.round}.`,
  ].join('\n');
}

export function normalizeSource(s: string): string {
  return s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}

/** Rename every identifier `from` to `to` (declaration and self-recursive calls). Property names are left alone. */
export function renameFunction(source: string, from: string, to: string): string {
  const sf = ts.createSourceFile('c.ts', source, ts.ScriptTarget.ES2022, true);
  const edits: Array<[number, number]> = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === from) {
      const p = n.parent;
      const isProp = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isPropertySignature(p) && p.name === n);
      if (!isProp) edits.push([n.getStart(sf), n.getEnd()]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  let out = source;
  for (const [s, e] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + to + out.slice(e);
  return out;
}

export interface FunctionSpan {
  /** Start (including leading JSDoc) and end offsets of the function declaration. */
  start: number;
  end: number;
  text: string;
}

/** Locate the exported function declaration `fn` (with its JSDoc) in a file. */
export function findFunction(fileSource: string, fn: string): FunctionSpan | null {
  const sf = ts.createSourceFile('f.ts', fileSource, ts.ScriptTarget.ES2022, true);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === fn) {
      const docs = ts.getJSDocCommentsAndTags(st).filter(ts.isJSDoc);
      const start = docs.length ? docs[0]!.getStart(sf) : st.getStart(sf);
      return { start, end: st.getEnd(), text: fileSource.slice(start, st.getEnd()) };
    }
  }
  return null;
}

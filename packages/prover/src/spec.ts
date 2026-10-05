/**
 * Spec proposal: the model writes an executable Lean `def Spec.spec`, optional non-executable properties, and an English
 * rendering of each line. The prompt contains the TypeScript, the Lean model, the preconditions, the function name and its
 * JSDoc, and NOTHING else (no test inputs, no examples of the original's behavior). A revision (after the user rules "the spec is
 * wrong") additionally carries the previous spec and the ruled disagreements, which the user has already seen.
 *
 * Validation is ours: the spec must type-check against the model's argument and result types, may not reference the model's
 * own function (a spec defined as "whatever the original does" would make the agreement vacuous), and must run.
 */
import type { Precondition, Translation, Val, Outcome } from '@faithful/translate';
import { hashText } from '@faithful/core';
import { checkLean, type LeanDiagnostic } from './lean.js';
import { stripLeanComments, vetProofText } from './proofFile.js';

export const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    lean: { type: 'string', description: 'Lean 4 text: `namespace Spec` ... `def spec ...` ... `end Spec`. No imports.' },
    lines: {
      type: 'array',
      description: 'The definition split into consecutive logical lines, each with a plain English rendering.',
      items: { type: 'object', properties: { lean: { type: 'string' }, english: { type: 'string' } }, required: ['lean', 'english'], additionalProperties: false },
    },
    properties: {
      type: 'array',
      description: 'Optional extra non-executable properties of the result, as Lean `def name ... : Prop` text with English.',
      items: { type: 'object', properties: { name: { type: 'string' }, lean: { type: 'string' }, english: { type: 'string' } }, required: ['name', 'lean', 'english'], additionalProperties: false },
    },
    english: { type: 'string', description: 'One short paragraph: what the function is supposed to do.' },
  },
  required: ['lean', 'lines', 'properties', 'english'],
  additionalProperties: false,
} as const;

export interface SpecDraft {
  lean: string;
  lines: Array<{ lean: string; english: string }>;
  properties: Array<{ name: string; lean: string; english: string }>;
  english: string;
}

export interface SpecInputs {
  /** The function's source text as translated. */
  typescript: string;
  jsdoc: string | null;
  translation: Translation;
}

function preconditionWords(ps: Precondition[]): string {
  return ps.map((p) => `- ${p.words}`).join('\n');
}

function signature(t: Translation): string {
  const names = t.lean.paramNames ?? t.params.map((p) => p.name);
  const binders = t.lean.paramTypes.map((ty, i) => `(${names[i]} : ${ty})`).join(' ');
  return `def spec ${binders} : ${t.lean.retType}`;
}

export function buildSpecPrompt(inp: SpecInputs): string {
  const t = inp.translation;
  return [
    'You are writing a specification in Lean 4 for a TypeScript function. A person will read your spec, compare it with what the function does, and agree to it or not.',
    'Write an EXECUTABLE Lean definition of what the function should compute, written the way you would explain it, not a transliteration of the code: prefer the simplest obviously-correct definition (even if it is slow), and do not call the translated model.',
    '',
    `FUNCTION NAME: ${t.fnName}`,
    inp.jsdoc ? `JSDOC:\n${inp.jsdoc}` : 'JSDOC: (none)',
    '',
    'TYPESCRIPT:',
    '```ts',
    inp.typescript.trim(),
    '```',
    '',
    'LEAN MODEL (produced by a fixed translator; you may reuse its types, but your spec must not call Model.* functions):',
    '```lean',
    t.lean.source.trim(),
    '```',
    '',
    'PRECONDITIONS (the spec only has to be right on inputs that satisfy these):',
    preconditionWords(t.preconditions),
    '',
    'REQUIREMENTS:',
    `- Put everything in \`namespace Spec ... end Spec\`. Define exactly: \`${signature(t)}\` (same argument order and types; the result type is the model's result type${t.canThrow ? ', including `Except.error "message"` for inputs where the function throws that literal message' : ''}).`,
    '- It must be total and executable (`#eval Spec.spec ...` must work): structural recursion, List/Int/String functions from Lean core. No sorry, no partial, no axioms, no imports.',
    '- Return JSON: `lean` (the full text), `lines` (the same text split into consecutive logical lines, each with a one-sentence English rendering), `properties` (optional extra properties as `def name ... : Prop`; may be empty), `english` (one short paragraph).',
  ].join('\n');
}

export interface DisagreementForRevision {
  input: Val[];
  spec: Outcome;
  original: Outcome;
  note?: string;
}

export function buildSpecRevisionPrompt(inp: SpecInputs, previous: SpecDraft, rulings: DisagreementForRevision[]): string {
  const showOutcome = (o: Outcome): string => (o.tag === 'ok' ? JSON.stringify(o.value) : o.tag === 'throw' ? `throws "${o.message}"` : o.tag);
  return [
    buildSpecPrompt(inp),
    '',
    'YOUR PREVIOUS SPEC:',
    '```lean',
    previous.lean.trim(),
    '```',
    'The person ruled that your spec was WRONG on these inputs (the function is right). Revise the spec so that it agrees with the function on them, without making it a case table:',
    ...rulings.map((r, i) => `${i + 1}. input ${JSON.stringify(r.input)}: your spec returned ${showOutcome(r.spec)}; the function returns ${showOutcome(r.original)}${r.note ? ` (note: ${r.note})` : ''}`),
  ].join('\n');
}

export function parseSpecDraft(output: unknown): SpecDraft | string {
  const o = output as Partial<SpecDraft> | null;
  if (!o || typeof o.lean !== 'string' || !Array.isArray(o.lines) || !Array.isArray(o.properties) || typeof o.english !== 'string') return 'the model did not return the expected JSON shape';
  return {
    lean: o.lean,
    english: o.english,
    lines: o.lines.filter((l) => l && typeof l.lean === 'string' && typeof l.english === 'string').map((l) => ({ lean: l.lean, english: l.english })),
    properties: o.properties.filter((p) => p && typeof p.name === 'string' && typeof p.lean === 'string' && typeof p.english === 'string').map((p) => ({ name: p.name, lean: p.lean, english: p.english })),
  };
}

/** Textual reasons the spec is refused before compiling. */
export function vetSpecText(spec: string, t: Translation): string[] {
  const reasons = vetProofText({ helpers: spec, proof: 'x' }).filter((r) => !/open\/namespace/.test(r));
  const code = stripLeanComments(spec);
  if (/\bpartial\b/.test(code)) reasons.push('spec: partial definitions are not allowed');
  if (/^\s*import\b/m.test(code)) reasons.push('spec: no imports');
  if (!/\bnamespace\s+Spec\b/.test(code) || !/\bdef\s+spec\b/.test(code)) reasons.push('spec: must define `def spec` inside `namespace Spec`');
  // The spec may not call the translated model: that would make "the spec agrees with the function" vacuous.
  const fn = t.lean.names.original.replace(/^Model\./, '');
  const callsModel = new RegExp(`\\bModel\\.(?:${escapeRe(fn)}(?:_\\w+)?)\\b`).test(code) || new RegExp(`\\b${escapeRe(t.lean.names.original)}\\b`).test(code);
  if (callsModel) reasons.push(`spec: must not call ${t.lean.names.original}; the spec is an independent statement of what the function should do`);
  return reasons;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The file the spec is checked and evaluated in: model, then the spec. (Nothing of the model is editable.) */
export function specFile(t: Translation, specLean: string): string {
  return `${t.lean.source.trimEnd()}\n\n-- agreed spec\n${specLean.trim()}\n`;
}

export type SpecValidation = { ok: true; hash: string; ms: number } | { ok: false; errors: string[] };

/** Vet, then compile the spec against the model's types and check its type is exactly `params → result`. */
export async function validateSpec(t: Translation, draft: SpecDraft, opts: { budgetMs?: number; leanDir?: string } = {}): Promise<SpecValidation> {
  const reasons = vetSpecText(draft.lean, t);
  if (reasons.length) return { ok: false, errors: reasons };
  const names = t.lean.paramNames ?? t.params.map((p) => p.name);
  const arrow = [...t.lean.paramTypes, t.lean.retType].join(' → ');
  const check = `#check (Spec.spec : ${arrow})`;
  void names;
  const source = `${specFile(t, draft.lean)}\n${check}\n`;
  const r = await checkLean({ source, budgetMs: opts.budgetMs ?? 60_000, leanDir: opts.leanDir });
  if (r.timedOut) return { ok: false, errors: ['the spec took too long to compile'] };
  const errs = r.diagnostics.filter((d: LeanDiagnostic) => d.severity === 'error').map((d) => `line ${d.line}: ${d.message}`);
  if (errs.length) return { ok: false, errors: errs.slice(0, 6) };
  const warns = r.diagnostics.some((d) => d.kind === 'hasSorry');
  if (warns) return { ok: false, errors: ['the spec uses sorry'] };
  return { ok: true, hash: hashText(draft.lean.trim()), ms: r.ms };
}

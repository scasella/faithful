/**
 * The proof loop: ask Codex for a proof, check it ourselves, feed structured diagnostics (with goal states) back on
 * retry, stop on success or when the attempt/wall-clock budget runs out. A failed proof is reported as a failed proof.
 */
import { formatCount } from '@faithful/core';
import { CodexClient, type CodexCall } from './codex.js';
import type { LeanDiagnostic } from './lean.js';
import { checkProof, buildProofFile, type ProofAttempt, type ProofCheck, type ProofTarget } from './proofFile.js';

export const PROOF_SCHEMA = {
  type: 'object',
  properties: {
    helpers: { type: 'string', description: 'Lean lemmas/defs placed before the theorem. Empty string if none.' },
    proof: { type: 'string', description: 'Exactly the text after `:=` of the theorem: a term or a `by` block.' },
    reasoning: { type: 'string', description: 'Two or three sentences: the proof idea.' },
  },
  required: ['helpers', 'proof', 'reasoning'],
  additionalProperties: false,
} as const;

export interface ReferenceProof {
  /** Why it is offered, e.g. "proof that the original meets the spec". */
  description: string;
  statement: string;
  helpers: string;
  proof: string;
}

export interface ProveOptions {
  maxAttempts: number;
  /** Wall-clock for the whole loop, ms. */
  budgetMs: number;
  /** Per-attempt Lean wall-clock, ms. */
  checkBudgetMs: number;
  reference?: ReferenceProof;
  leanDir?: string;
  signal?: AbortSignal;
  onEvent?: (e: ProveEvent) => void;
}

export type ProveEvent =
  | { type: 'attempt-start'; n: number }
  | { type: 'codex-done'; n: number; call: CodexCall }
  | { type: 'checked'; n: number; check: ProofCheck; ms: number };

export interface ProofAttemptRecord {
  n: number;
  /** Codex call: its `prompt` is "What the model saw". */
  call: CodexCall;
  attempt: ProofAttempt | null;
  check: ProofCheck | null;
  /** Wall-clock of this attempt (model + Lean), ms. */
  ms: number;
}

export type ProofResultTier = 'proved' | 'proved-trusting-compiler' | 'not-proved';

export interface ProofRecord {
  theorem: string;
  statement: string;
  result: ProofResultTier;
  attempts: ProofAttemptRecord[];
  /** Wall-clock of the loop, ms. */
  ms: number;
  /** The accepted proof, when proved. */
  accepted: { attempt: ProofAttempt; source: string; axioms: string[] } | null;
  /** Last failing diagnostics, kept so a failed proof can be shown with its goal state. */
  lastDiagnostics: LeanDiagnostic[];
  stoppedBy: 'proved' | 'attempts' | 'time' | 'codex-error' | 'aborted';
}

export function formatDiagnostics(diags: LeanDiagnostic[], max = 6): string {
  return diags
    .filter((d) => d.severity === 'error')
    .slice(0, max)
    .map((d) => `error at line ${d.line}, column ${d.column}:\n${d.message}`)
    .join('\n\n');
}

export function buildProofPrompt(target: ProofTarget, history: ProofAttemptRecord[], reference?: ReferenceProof): string {
  const shown = buildProofFile(target, 'sorry', { fingerprint: false }).source.replace(/:=\s*sorry\s*$/m, ':=\n  <YOUR PROOF GOES HERE>');
  const lib = target.library?.trim();
  const out: string[] = [
    'You are writing a Lean 4 proof. Lean 4.34.0, Mathlib (only the tactic modules imported below are available). A checker will compile your answer;',
    'you cannot run Lean, so write carefully and prefer robust tactics (simp, omega, decide, induction, cases, split, unfold, rfl, List lemmas).',
    '',
    'THE FILE (the model and the spec are fixed; do not restate them):',
    '```lean',
    shown.trim(),
    '```',
    ...(lib ? ['', 'THE RUNTIME LIBRARY the model uses (Faithful.Core; read-only, already imported; its definitions are what `Faithful.*` names in the model mean):', '```lean', lib, '```'] : []),
    '',
    `TASK: prove \`${target.theoremName}\`. Return JSON with:`,
    '- "helpers": optional Lean lemmas or defs placed BEFORE the theorem (empty string if none). They may not use sorry, axiom, notation, macro, open, namespace, instance or #commands.',
    '- "proof": exactly the text after `:=` (a term, or a `by` block).',
    '- "reasoning": two or three sentences on the proof idea.',
    'Do not use `sorry`. `native_decide` is accepted but downgrades the claim to "proved, trusting the compiler"; prefer `decide`, `omega`, `simp`, or an induction.',
    'The hypothesis `Model.pre ... = true` bundles the input bounds and the range conditions; `simp [Model.pre]` unfolds it.',
  ];
  if (reference) {
    out.push('', `A REFERENCE PROOF that may be adaptable (${reference.description}); its statement was \`${reference.statement}\`:`, '```lean');
    if (reference.helpers.trim()) out.push(reference.helpers.trim(), '');
    out.push(reference.proof.trim(), '```');
  }
  const failed = history.filter((h) => h.check && h.check.verdict.status !== 'proved');
  if (failed.length) {
    out.push('', 'PREVIOUS ATTEMPTS (most recent last). Fix the reported errors; do not repeat an approach that failed the same way.');
    for (const h of failed.slice(-3)) {
      const v = h.check!.verdict;
      out.push(`--- attempt ${h.n} ---`, '```lean');
      if (h.attempt?.helpers.trim()) out.push(h.attempt.helpers.trim(), '');
      out.push(h.attempt?.proof.trim() ?? '', '```');
      if (v.status === 'rejected') out.push('Rejected before compiling: ' + v.reasons.join('; '));
      else if (v.status === 'failed') {
        out.push(`Result: ${v.reason}${v.axioms ? ` (axioms: ${v.axioms.join(', ')})` : ''}`);
        const d = formatDiagnostics(h.check!.diagnostics);
        if (d) out.push('Lean diagnostics (with goal states):', d);
      }
    }
  }
  return out.join('\n');
}

/** Run the loop. `codex` is shared so that call counts and serialization span the whole session. */
export async function proveTheorem(codex: CodexClient, target: ProofTarget, opts: ProveOptions): Promise<ProofRecord> {
  const t0 = performance.now();
  const attempts: ProofAttemptRecord[] = [];
  let stoppedBy: ProofRecord['stoppedBy'] = 'attempts';
  let accepted: ProofRecord['accepted'] = null;
  let result: ProofResultTier = 'not-proved';
  for (let n = 1; n <= opts.maxAttempts; n++) {
    if (opts.signal?.aborted) { stoppedBy = 'aborted'; break; }
    const left = opts.budgetMs - (performance.now() - t0);
    if (left <= 5_000) { stoppedBy = 'time'; break; }
    opts.onEvent?.({ type: 'attempt-start', n });
    const a0 = performance.now();
    const prompt = buildProofPrompt(target, attempts, opts.reference);
    const call = await codex.ask({ purpose: 'proof-attempt', prompt, schema: PROOF_SCHEMA, timeoutMs: Math.min(left, 600_000), signal: opts.signal });
    opts.onEvent?.({ type: 'codex-done', n, call });
    if (call.error) {
      attempts.push({ n, call, attempt: null, check: null, ms: performance.now() - a0 });
      stoppedBy = call.error.code === 'aborted' ? 'aborted' : 'codex-error';
      break;
    }
    const o = call.output as { helpers?: unknown; proof?: unknown };
    const attempt: ProofAttempt = { helpers: typeof o.helpers === 'string' ? o.helpers : '', proof: typeof o.proof === 'string' ? o.proof : '' };
    const check = await checkProof(target, attempt, { budgetMs: Math.max(5_000, Math.min(opts.checkBudgetMs, opts.budgetMs - (performance.now() - t0))), leanDir: opts.leanDir });
    opts.onEvent?.({ type: 'checked', n, check, ms: performance.now() - a0 });
    attempts.push({ n, call, attempt, check, ms: performance.now() - a0 });
    if (check.verdict.status === 'proved') {
      result = check.verdict.tier;
      accepted = { attempt, source: check.source!, axioms: check.verdict.axioms };
      stoppedBy = 'proved';
      break;
    }
  }
  const last = attempts.at(-1);
  return {
    theorem: target.theoremName,
    statement: target.statement,
    result,
    attempts,
    ms: performance.now() - t0,
    accepted,
    lastDiagnostics: last?.check?.diagnostics ?? [],
    stoppedBy,
  };
}

/** "Not proved (3 attempts, 4.2 minutes)": the exact wording for a failed proof. */
export function failureLine(r: ProofRecord): string {
  const mins = r.ms / 60_000;
  const n = r.attempts.length;
  return `Not proved (${formatCount(n)} attempt${n === 1 ? '' : 's'}, ${mins < 0.1 ? '<0.1' : mins.toFixed(1)} minute${mins === 1 ? '' : 's'})`;
}

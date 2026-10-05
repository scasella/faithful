/**
 * Pure logic behind the Prove-original screen. Wording rules:
 *  - A failed proof reads exactly "Not proved (N attempts, M minutes)": `ProofView.failureLine` when the server sent it,
 *    otherwise the same formula as `failureLine` in packages/prover/src/prove.ts (kept identical; tested).
 *  - The budget maximum is `ProofView.budget`, set by the server on `proof.started` from the request, so it survives a
 *    reload and a replay. Older recordings without it: the screen says it was not recorded instead of guessing.
 */
import { ALLOWED_AXIOMS, formatCount, isCompilerTrustAxiom } from '@faithful/core/tiers';
import type { ProofAttemptView, ProofView, SessionState, StampedEvent } from '@faithful/session';
import type { ProveBudget } from '../../actions';

/** The theorem in plain words. Fixed wording; the server's own `statementWords` is shown beneath it when it differs. */
export const THEOREM_WORDS = 'For every input satisfying the preconditions, the original returns exactly what the agreed spec says.';

/** The direct theorem offered when the spec proof does not close (later in the loop, per candidate). */
export const DIRECT_THEOREM = '∀ x, pre x → candidate x = original x';

export const DEFAULT_BUDGET: ProveBudget = { maxAttempts: 3, minutes: 5 };

/** Mirrors `failureLine` in packages/prover/src/prove.ts exactly. */
export function notProvedLine(attempts: number, ms: number): string {
  const mins = ms / 60_000;
  return `Not proved (${formatCount(attempts)} attempt${attempts === 1 ? '' : 's'}, ${mins < 0.1 ? '<0.1' : mins.toFixed(1)} minute${mins === 1 ? '' : 's'})`;
}

/** The failure line to print: the server's, else the same formula over the recorded attempts and time. */
export function failureLineOf(p: Pick<ProofView, 'failureLine' | 'attempts' | 'ms'>): string {
  return p.failureLine && p.failureLine.startsWith('Not proved') ? p.failureLine : notProvedLine(p.attempts.length, p.ms);
}

export function isProvedResult(r: ProofView['result']): r is 'proved' | 'proved-trusting-compiler' {
  return r === 'proved' || r === 'proved-trusting-compiler';
}

/** What Lean said about one attempt, in plain words. Never "proved" for an attempt Lean did not accept. */
export function attemptVerdictText(a: Pick<ProofAttemptView, 'verdict'>): string {
  switch (a.verdict) {
    case 'proved':
      return 'Lean accepted this proof';
    case 'proved-trusting-compiler':
      return 'Lean accepted this proof, trusting the compiler';
    case 'failed':
      return 'Lean did not accept this proof';
    case 'rejected':
      return 'Rejected before Lean checked it';
  }
}

export interface AxiomReport {
  standard: string[];
  compiler: string[];
  other: string[];
}

/** Split `#print axioms` output into the three standard axioms, compiler-trust axioms, and anything else. */
export function classifyAxioms(axioms: readonly string[]): AxiomReport {
  const std = ALLOWED_AXIOMS as readonly string[];
  return {
    standard: axioms.filter((a) => std.includes(a)),
    compiler: axioms.filter((a) => !std.includes(a) && isCompilerTrustAxiom(a)),
    other: axioms.filter((a) => !std.includes(a) && !isCompilerTrustAxiom(a)),
  };
}

export const TRUSTING_COMPILER_EXPLAINED =
  'The proof uses native_decide: Lean ran compiled code to decide a step instead of checking it in the kernel. ' +
  'This result therefore also trusts the Lean compiler and its runtime, not only the kernel and the three standard axioms.';

// ───────────── budget ─────────────

export type BudgetParse = { ok: true; budget: ProveBudget } | { ok: false; error: string };

export function parseBudget(attempts: string, minutes: string): BudgetParse {
  const a = Number(attempts.trim());
  const m = Number(minutes.trim());
  if (!attempts.trim() || !Number.isInteger(a) || a < 1 || a > 50) return { ok: false, error: 'Attempts must be a whole number from 1 to 50.' };
  if (!minutes.trim() || !Number.isFinite(m) || m <= 0 || m > 240) return { ok: false, error: 'Minutes must be a number above 0 and at most 240.' };
  return { ok: true, budget: { maxAttempts: a, minutes: m } };
}

/** The "larger budget" offer after a failure: twice the previous budget (or twice what was used when it is unknown). */
export function largerBudget(p: Pick<ProofView, 'attempts' | 'ms' | 'budget'>): ProveBudget {
  const prev = p.budget ?? null;
  const usedMin = Math.max(1, Math.ceil(p.ms / 60_000));
  const baseA = prev?.maxAttempts ?? Math.max(1, p.attempts.length);
  const baseM = prev?.minutes ?? usedMin;
  return { maxAttempts: Math.min(50, baseA * 2), minutes: Math.min(240, baseM * 2) };
}

// ───────────── elapsed time ─────────────

/**
 * Elapsed time of a proof from the event stream: for a finished proof its recorded `ms`; for a running one the stream
 * time between its `proof.started` event and the latest event (callers add local wall-clock time since that event to
 * tick live).
 */
export function proofElapsedMs(p: ProofView, events: readonly StampedEvent[]): number {
  if (p.result !== 'running') return p.ms;
  let t0: number | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!.event;
    if (e.kind === 'proof.started' && e.proof.theoremId === p.theoremId) {
      t0 = events[i]!.t;
      break;
    }
  }
  const last = events.at(-1);
  return t0 === null || !last ? 0 : Math.max(0, last.t - t0);
}

/** The proof of the original: the latest one pinned to the current agreement, else the latest one. */
export function originalProof(s: SessionState): ProofView | null {
  const pinned = s.agreement ? s.proofs.filter((p) => p.pinnedTo === s.agreement!.hash) : [];
  return pinned.at(-1) ?? s.proofs.at(-1) ?? null;
}

/** "1.7" minutes, rounded down, so a running clock never shows the budget as spent before it is. */
export function minutesText(ms: number): string {
  return (Math.floor((ms / 60_000) * 10 + 1e-9) / 10).toFixed(1);
}

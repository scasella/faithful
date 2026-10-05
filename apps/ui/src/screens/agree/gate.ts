/**
 * Agree screen logic, pure: what the challenge list shows, whether "Agree" is available and exactly why not, the ruling
 * payloads, and rulings in plain words. Rendering lives in AgreeScreen.tsx.
 */
import { unruledChallenges, type Challenge, type ChallengeRun, type Ruling, type SessionState, type SpecProposal } from '@faithful/session';
import type { CarveClass, RulingInput } from '../../actions';
import { inputText } from '../../lib/format';
import { paramNames } from '../../lib/facts';

export interface AgreeView {
  proposal: SpecProposal | null;
  /** Hash of the latest proposal when it validated. */
  specHash: string | null;
  /** All runs against the latest spec, oldest first, and the latest of them. */
  runs: ChallengeRun[];
  lastRun: ChallengeRun | null;
  /** The challenge list: disagreements of the latest run against the latest spec. */
  challenges: Challenge[];
  /** Ids in `challenges` without a ruling for the latest spec. */
  unruled: string[];
  /** Ruling for each challenge id, for the latest spec. */
  ruled: Map<string, Ruling>;
}

export function agreeView(s: SessionState): AgreeView {
  const proposal = s.proposals.at(-1) ?? null;
  const specHash = proposal?.validation.ok ? proposal.validation.hash : null;
  const runs = specHash ? s.challengeRuns.filter((r) => r.specHash === specHash) : [];
  const lastRun = runs.at(-1) ?? null;
  const ruled = new Map<string, Ruling>();
  if (specHash) for (const r of s.rulings) if (r.specHash === specHash) ruled.set(r.challengeId, r);
  return {
    proposal,
    specHash,
    runs,
    lastRun,
    challenges: lastRun?.disagreements ?? [],
    unruled: specHash ? unruledChallenges(s, specHash) : [],
    ruled,
  };
}

export type Gate =
  | { ok: true; specHash: string }
  | {
      ok: false;
      /** Exactly why Agree is not available, in plain words. */
      reason: string;
      /** The action that resolves it, when there is one. */
      next?: 'propose' | 'revise' | 'rerun' | 'rule' | 'reopen';
    };

function inputs(s: SessionState, list: Challenge[]): string {
  const names = paramNames(s);
  return list.map((c) => inputText(c.input, names)).join('; ');
}

function count(n: number, one: string, many: string): string {
  return `${n === 1 ? 'one' : n === 2 ? 'two' : n === 3 ? 'three' : String(n)} ${n === 1 ? one : many}`;
}

/** Can the user agree now? The checks run in the order a user meets them; the first failing one is the reason. */
export function agreeGate(s: SessionState, v: AgreeView = agreeView(s)): Gate {
  if (s.agreement) return { ok: false, reason: `Already agreed (agreement ${s.agreement.hash}).` };
  if (!v.proposal) return { ok: false, reason: 'No spec has been proposed yet.', next: 'propose' };
  if (!v.specHash) return { ok: false, reason: 'The server did not accept the latest spec (its errors are shown with the spec), so it cannot be agreed. Ask the model for a new one.', next: 'propose' };
  if (!v.lastRun) return { ok: false, reason: 'The challenge has not run against the latest spec yet.', next: 'rerun' };
  if (v.unruled.length) {
    const open = v.challenges.filter((c) => v.unruled.includes(c.id));
    return {
      ok: false,
      reason: `Agree is unavailable: ${count(open.length, 'challenge is', 'challenges are')} unruled (${inputs(s, open)}). Rule each one first.`,
      next: 'rule',
    };
  }
  const specWrong = v.challenges.filter((c) => v.ruled.get(c.id)?.ruling === 'spec-wrong');
  if (specWrong.length) {
    return {
      ok: false,
      reason: `You ruled the spec wrong on ${inputs(s, specWrong)}. Revise the spec, then rule the new challenge run.`,
      next: 'revise',
    };
  }
  const fix = v.challenges.filter((c) => {
    const r = v.ruled.get(c.id);
    return r?.ruling === 'function-wrong' && r.then === 'fix-original';
  });
  if (fix.length) {
    return {
      ok: false,
      reason: `You ruled your function wrong on ${inputs(s, fix)} and chose to fix it. Edit the file, then open the function again. This spec cannot be agreed for the current source.`,
      next: 'reopen',
    };
  }
  // The search is current only for the carve-outs it ran under (the server checks the same).
  const ran = v.lastRun.carveOutIds;
  const have = s.carveOuts.map((c) => c.id);
  if (ran && JSON.stringify(ran) !== JSON.stringify(have)) {
    return { ok: false, reason: 'The challenge has not run with the current carve-outs yet. Re-run it.', next: 'rerun' };
  }
  // Every listed disagreement is ruled, but the server agrees only when the latest search found none: a carve-out
  // ruling re-runs it; otherwise revise the spec or re-run.
  const total = v.lastRun.totalDisagreements ?? v.lastRun.disagreements.length;
  if (total > 0) {
    const hidden = total - v.lastRun.disagreements.length;
    return {
      ok: false,
      reason: `The latest challenge run still found ${count(total, 'disagreement', 'disagreements')}${hidden > 0 ? ` (${hidden} not listed)` : ''}. Agreeing needs a run with none: carve out, revise the spec, or re-run.`,
      next: 'rerun',
    };
  }
  return { ok: true, specHash: v.specHash };
}

// ───────────── the ruling flow (keyboard: s, f, then x / c) ─────────────

/** Per-challenge step of the ruling flow. 'function-wrong' asks: fix the original, or carve the class out? */
export type RulingStep = 'idle' | 'function-wrong' | 'carve-out';

export function specWrong(note?: string): RulingInput {
  return note ? { ruling: 'spec-wrong', note } : { ruling: 'spec-wrong' };
}

export function fixOriginal(note?: string): RulingInput {
  return note ? { ruling: 'function-wrong', then: 'fix-original', note } : { ruling: 'function-wrong', then: 'fix-original' };
}

/**
 * "My function is wrong" -> carve out: the class picked from the server's menu (`GET /api/challenge/carve-options`).
 * The server builds the carve-out's Lean and TypeScript conditions from the class; the UI never writes a condition.
 */
export function carveRuling(carve: CarveClass, note?: string): RulingInput {
  return note ? { ruling: 'function-wrong', then: 'carve-out', carve, note } : { ruling: 'function-wrong', then: 'carve-out', carve };
}

/** A ruling in plain words, for the challenge list, the examples table and the confirmation. */
export function rulingWords(r: Ruling, carveOutListed = false): string {
  if (r.ruling === 'spec-wrong') return 'The spec is wrong here.';
  if (r.then === 'fix-original') return 'My function is wrong here; I will fix it.';
  if (carveOutListed) return 'My function is wrong here; carved out (see Carve-outs).';
  return r.carveOut ? `My function is wrong here; carved out: ${r.carveOut.words}` : 'My function is wrong here; carved out.';
}

/** A ruling in a few words, for the examples table (the carve-out's own words are in the band above it). */
export function rulingShort(r: Ruling): string {
  if (r.ruling === 'spec-wrong') return 'Spec wrong';
  return r.then === 'fix-original' ? 'Function wrong; to be fixed' : 'Function wrong; carved out';
}

/** Every disagreement recorded against the latest spec, across its runs, without repeats (latest run's copy wins). */
export function recordedExamples(v: AgreeView): Array<{ c: Challenge; runId: number }> {
  const by = new Map<string, { c: Challenge; runId: number }>();
  for (const r of v.runs) for (const c of r.disagreements) by.set(c.id, { c, runId: r.id });
  return [...by.values()];
}

/** Offsets of a spec line's Lean text inside the full spec, for the hover mapping. Null when it is not a literal part. */
export function leanSpan(full: string, line: string): { start: number; end: number } | null {
  const t = line.trim();
  if (!t) return null;
  const i = full.indexOf(t);
  return i < 0 ? null : { start: i, end: i + t.length };
}

/** The server revises only from "the spec is wrong" rulings on the current spec: are there any? */
export function canRevise(s: SessionState, v: AgreeView = agreeView(s)): boolean {
  return !!v.specHash && s.rulings.some((r) => r.specHash === v.specHash && r.ruling === 'spec-wrong');
}

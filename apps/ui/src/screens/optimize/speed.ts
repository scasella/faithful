/**
 * Pure logic for the Optimize screen: the benchmark verdict, the accept-at-Verified-to-k consequence, the final readout.
 * Rules:
 *  - One rule for "faster": `Speedup.significant` (and an interval that prints above 1, `canSayFaster`), decided by the server's benchmark comparison of the candidate with the
 *    ORIGINAL on the declared distribution (CandidateRecord.speedup is always versus the original). The page never
 *    re-derives it from the printed intervals. Whether a candidate beat the current best is the server's decision too
 *    (outcome `incumbent` vs `not-faster`).
 *  - Never the word "Proved" here: the consequence text names the Lean proof instead, so no sentence is needed.
 */
import type { CandidateRecord, SessionState } from '@faithful/session';
import { TIER_LABEL } from '@faithful/core/tiers';
import { catchView } from '../../lib/catch';
import { canSayFaster } from '../../lib/format';
import { nForCandidate, smtK } from '../../lib/facts';

export type BenchVerdict = 'faster' | 'not-shown' | 'no-ratio' | 'not-benchmarked';

export const VERDICT_WORDS: Record<BenchVerdict, string> = {
  faster: 'Faster than the original on the declared distribution (the benchmark separates them).',
  'not-shown': 'Not shown to be faster than the original on the declared distribution.',
  'no-ratio': 'No comparison with the original is recorded.',
  'not-benchmarked': 'Not benchmarked.',
};

/** The benchmark verdict vs the original: `speedup.significant`, and only when its interval prints above 1 (`canSayFaster`). */
export function verdictText(c: Pick<CandidateRecord, 'bench' | 'speedup'>): { verdict: BenchVerdict; text: string } {
  const v: BenchVerdict = !c.bench && !c.speedup ? 'not-benchmarked' : !c.speedup ? 'no-ratio' : canSayFaster(c.speedup) ? 'faster' : 'not-shown';
  return { verdict: v, text: VERDICT_WORDS[v] };
}

// ───────────── accept at Verified to k ─────────────

export function verifiedLabel(k: number | null): string {
  return k === null ? `${TIER_LABEL['verified-to-k']} (bound not recorded)` : `${TIER_LABEL['verified-to-k']}=${k}`;
}

/**
 * What accepting a "faster, not proved" candidate means, in sentences shown next to the action.
 * `incumbent` is the current best (if any, and not this candidate).
 */
export function acceptConsequence(c: Pick<CandidateRecord, 'id' | 'stages'>, incumbent: Pick<CandidateRecord, 'id' | 'tier'> | null): string[] {
  const k = smtK(c as CandidateRecord);
  const label = verifiedLabel(k);
  const out = [
    `Candidate ${c.id} becomes the delivered candidate at ${label}: Z3 found no input${k === null ? '' : ` up to k=${k}`} where it differs from the original. It is not proved against the agreed spec.`,
  ];
  if (incumbent && incumbent.id !== c.id) {
    if (incumbent.tier === 'proved' || incumbent.tier === 'proved-trusting-compiler') {
      out.push(`It replaces candidate ${incumbent.id}. The delivery would no longer rest on candidate ${incumbent.id}'s Lean proof, only on the bounded check.`);
    } else {
      out.push(`It replaces candidate ${incumbent.id} as the delivered candidate.`);
    }
  }
  out.push(`Delivery will mark it: the evidence line says ${label} and not proved, and provenance.json records that you accepted it below the proof tier.`);
  return out;
}

/**
 * Can a "faster, not proved" candidate be accepted? Only at the Verified-to-k tier (the server refuses the rest): null
 * when it can, else why not, in plain words.
 */
export function acceptBlocker(c: Pick<CandidateRecord, 'id' | 'outcome' | 'tier'>): string | null {
  if (c.outcome !== 'faster-not-proved') return `Candidate ${c.id} is not marked faster, not proved.`;
  if (c.tier !== 'verified-to-k') {
    return `Candidate ${c.id} reached only the ${TIER_LABEL[c.tier ?? 'tested']} tier: the bounded SMT check did not complete for it, so it cannot be accepted without a proof.`;
  }
  return null;
}

// ───────────── final readout ─────────────

export const STOPPED_WORDS: Record<NonNullable<SessionState['optimize']['stoppedBy']>, string> = {
  threshold: 'the threshold was reached',
  budget: 'the time budget ran out',
  'no-new-candidate': 'the model proposed no new candidate',
  'round-limit': 'the round limit was reached',
  user: 'you stopped it',
};

export interface ReadoutRow {
  id: number;
  outcome: CandidateRecord['outcome'];
  text: string;
}

export interface FinalReadout {
  stoppedWords: string;
  incumbent: CandidateRecord | null;
  tried: number;
  rows: ReadoutRow[];
}

/** The summary shown once optimization has stopped. Null while it runs or before it starts. */
export function finalReadout(s: SessionState, params: string[] | null): FinalReadout | null {
  const o = s.optimize;
  if (o.startedAt === null || o.stoppedBy === null) return null;
  const inc = o.incumbentId === null ? null : (o.candidates.find((c) => c.id === o.incumbentId) ?? null);
  const rows: ReadoutRow[] = [];
  for (const c of o.candidates) {
    if (c.id === inc?.id) continue;
    let text: string;
    switch (c.outcome) {
      case 'rejected':
        text = c.rejection ? `Rejected: ${catchView(c, params, nForCandidate(s, c))!.reason}` : 'Rejected; no reason was recorded.';
        break;
      case 'not-faster':
        text = c.rejection?.reason ? `Not faster: ${c.rejection.reason}` : 'Not faster than the current best.';
        break;
      case 'faster-not-proved':
        text = 'Faster, not proved. Not accepted.';
        break;
      case 'accepted-at-verified':
        text = 'Accepted by you at its tier, later replaced.';
        break;
      case 'incumbent':
        text = 'Was the current best, later replaced.';
        break;
      case 'running':
        text = 'Still being checked when optimization stopped.';
        break;
    }
    rows.push({ id: c.id, outcome: c.outcome, text });
  }
  return { stoppedWords: STOPPED_WORDS[o.stoppedBy], incumbent: inc, tried: o.candidates.length, rows };
}

/**
 * "Why this label and not a stronger one", pure: the server's own words for what stopped a candidate below the proof
 * tier. The rejection reason verbatim when one is recorded; otherwise the summaries of the stages that failed or were
 * skipped, in gate order. When the SMT stage says its claim was NARROWED, the narrowed bound is stated as well.
 * Never derived prose: a candidate with nothing recorded gets no panel.
 */
import type { CandidateRecord } from '@faithful/session';
import { GATE_LABEL, GATE_ORDER, narrowing, narrowingSentence } from '../../components/gates';
import { smtK, stageOf } from '../../lib/facts';
import { isProvedTier, stageSummaryText } from '../../lib/tierText';

export interface WhyView {
  /** Verbatim reasons (the rejection reason, or "Stage: summary" lines). */
  lines: string[];
  /** The narrowed-bound sentence of the SMT stage, when its summary says NARROWED. */
  narrowed: string | null;
}

export function whyNotStronger(c: CandidateRecord): WhyView | null {
  // Running: not decided. Rejected: the CatchCard says why. Proved: there is no stronger label.
  if (c.outcome === 'running' || c.outcome === 'rejected' || isProvedTier(c.tier)) return null;
  const reason = (c.rejection?.reason ?? '').trim();
  const lines = reason
    ? [stageSummaryText(reason)]
    : GATE_ORDER.map((id) => stageOf(c, id))
        .filter((r): r is NonNullable<typeof r> => !!r && (r.status === 'fail' || r.status === 'skipped') && !!r.summary.trim())
        .map((r) => `${GATE_LABEL[r.stage]}: ${stageSummaryText(r.summary.trim())}`);
  const smt = stageOf(c, 'smt');
  const n = smt && smt.status === 'pass' ? narrowing(smt.summary) : null;
  const narrowed = n ? narrowingSentence(smtK(c), n) : null;
  if (!lines.length && !narrowed) return null;
  return { lines, narrowed };
}

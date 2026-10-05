/**
 * The evidence line, built only from facts present in state. Example (all facts present):
 *   "Proved against the agreed spec (Lean 4.34.0, Mathlib 5ed2965). Verified to k=6. 1,000 differential inputs.
 *    12 of 12 broken copies of the original were caught by these inputs. 4.2× faster than the original (95% CI 3.9–4.6)
 *    on the declared distribution."
 * followed by `provedSentence(N)` whenever "Proved" appears, N being THIS candidate's model check. A clause whose fact is
 * absent is omitted.
 */
import type { CandidateRecord, SessionState } from '@faithful/session';
import { TIER_LABEL, formatCount } from '@faithful/core/tiers';
import { candidateModelCheck, differentialDetail, mutationOf, smtK, stageOf } from './facts';
import { ciText, floor1, nsText, ratioText } from './format';
import { leanVersions } from './provenance';
import { WITHHELD_NOTE, isProvedTier, mismatchNote, stageSummaryText, tierText } from './tierText';

export interface Clause {
  id: 'tier' | 'smt' | 'differential' | 'mutants' | 'undistinguished' | 'speedup' | 'no-speedup';
  text: string;
  /** What the number is, for the provenance popover. */
  what: string;
}

export interface EvidenceLine {
  clauses: Clause[];
  /** provedSentence(N) whenever a clause says "Proved"; the withheld-label note when N is unknown. */
  provedNote: string | null;
  /** N used for provedNote (null when withheld). */
  n: number | null;
}

/** "12 of 12 broken copies of the original were caught by these inputs." */
export function mutationText(m: { caught: number; total: number }): string {
  return `${formatCount(m.caught)} of ${formatCount(m.total)} broken copies of the original were caught by these inputs.`;
}

/** Undistinguished broken copies are never counted as caught: they are said separately. */
export function undistinguishedText(n: number): string {
  return `${n === 1 ? 'One broken copy' : `${formatCount(n)} broken copies`} could not be told apart from the original on any input tried; not counted as caught.`;
}

export function evidenceFor(s: SessionState, c: CandidateRecord): EvidenceLine {
  const clauses: Clause[] = [];
  const check = candidateModelCheck(s, c.id);
  const n = check?.inputs ?? null;
  const lv = leanVersions(s.toolchain);
  const versions = lv ? ` (${lv})` : '';
  let note: string | null = null;
  if (isProvedTier(c.tier)) {
    const t = tierText(c.tier, { n });
    clauses.push({ id: 'tier', text: `${t.label} against the agreed spec${versions}.`, what: 'Lean checked the proof and its axioms' });
    note = t.sentence ? (check && check.disagreements > 0 ? `${t.sentence} ${mismatchNote(check.disagreements)}` : t.sentence) : WITHHELD_NOTE;
  } else if (c.tier === 'not-proved') {
    clauses.push({ id: 'tier', text: `${TIER_LABEL['not-proved']} against the agreed spec.`, what: 'No proof was accepted by Lean' });
  }

  const smt = stageOf(c, 'smt');
  const k = smtK(c);
  if (smt?.status === 'pass' && k !== null) clauses.push({ id: 'smt', text: `${TIER_LABEL['verified-to-k']}=${k}.`, what: `Z3 bounded check, ${stageSummaryText(smt.summary)}` });

  const diff = stageOf(c, 'differential');
  const dd = differentialDetail(c);
  if (diff?.status === 'pass' && dd) {
    clauses.push({ id: 'differential', text: `${formatCount(dd.compared)} differential inputs.`, what: `Original and candidate compared value by value (seed ${dd.seed})` });
  }
  const m = mutationOf(c);
  if (m) {
    clauses.push({ id: 'mutants', text: mutationText(m), what: 'Mutation check: broken copies of the original run on the same differential inputs' });
    if (m.undistinguished > 0) clauses.push({ id: 'undistinguished', text: undistinguishedText(m.undistinguished), what: 'Mutation check: broken copies no input told apart' });
  }

  if (c.speedup && c.bench) {
    if (c.speedup.significant) {
      clauses.push({
        id: 'speedup',
        text: `${ratioText(c.speedup)} faster than the original (${ciText(c.speedup.lo, c.speedup.hi)}) on the declared distribution.`,
        what: `Benchmark vs the original: ${formatCount(c.bench.trials)} trials, median ${nsText(c.bench.median)}, distribution ${c.bench.distribution}`,
      });
    } else {
      clauses.push({
        id: 'no-speedup',
        text: `Not shown to be faster than the original: ${floor1(c.speedup.ratio)}× (${ciText(c.speedup.lo, c.speedup.hi)}) on the declared distribution.`,
        what: `Benchmark vs the original: ${formatCount(c.bench.trials)} trials, distribution ${c.bench.distribution}`,
      });
    }
  }

  return { clauses, provedNote: note, n: note && n !== null && isProvedTier(c.tier) ? n : null };
}

export function evidenceText(e: EvidenceLine): string {
  return [e.clauses.map((c) => c.text).join(' '), e.provedNote ?? ''].filter(Boolean).join('\n');
}

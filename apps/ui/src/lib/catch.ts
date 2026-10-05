/**
 * Pure derivation behind the CatchCard: everything the card says about a rejected candidate, computed from state facts.
 *
 * Exactness rules encoded here:
 *  - "Caught: ... differs" only when a concrete counterexample exists. A failed proof without one is "not proved", which
 *    is the absence of a proof, never a demonstration that the candidate is wrong.
 *  - The plain-words reason is `Rejection.reason` (data). When it is missing, a neutral sentence is derived from the
 *    counterexample and nothing else.
 *  - The speedup is shown (struck through) only when it was measured; otherwise the card says it was not.
 */
import type { CandidateRecord, Rejection, Speedup, StageId } from '@faithful/session';
import type { Outcome, Val } from '@faithful/translate';
import { TIER_LABEL, formatCount, type Tier } from '@faithful/core/tiers';
import { WITHHELD_NOTE, tierText } from './tierText';
import { differentialDetail, smtK, stageOf } from './facts';
import { inputText, outcomeEqual, outcomeVerb } from './format';

export const STAGE_LABEL: Record<StageId, string> = {
  compile: 'Compile',
  purity: 'Purity',
  differential: 'Differential',
  smt: 'SMT',
  proof: 'Proof',
  benchmark: 'Benchmark',
};

export interface CatchView {
  candidateId: number;
  round: number;
  /** True only with a concrete counterexample. */
  differs: boolean;
  heading: string;
  /** What caught it: "Z3 found an input up to k=6 where the candidate differs". */
  caughtBy: string;
  stage: StageId;
  kind: Rejection['kind'];
  reason: string;
  reasonDerived: boolean;
  counterexample: {
    inputs: Array<{ name: string | null; value: Val }>;
    inputLine: string;
    original: Outcome;
    candidate: Outcome;
    source: 'differential' | 'smt';
  } | null;
  theorem: string | null;
  goal: string | null;
  speedup: Speedup | null;
  /** Shown when there is no speedup to strike through. */
  speedupNote: string | null;
  believe: { tier: Tier | null; tierLabel: string | null; sentences: string[] };
}

export function neutralReason(input: Val[], original: Outcome, candidate: Outcome, names: string[] | null): string {
  const where = inputText(input, names);
  if (outcomeEqual(original, candidate)) return `For ${where} the two outputs were recorded as different, but they print the same; see the raw outcomes.`;
  return `For ${where} the candidate ${outcomeVerb(candidate)}, the original ${outcomeVerb(original)}.`;
}

function caughtBy(c: CandidateRecord, r: Rejection): string {
  switch (r.kind) {
    case 'smt-counterexample': {
      const k = smtK(c);
      return k === null ? 'Z3 found an input where the candidate differs' : `Z3 found an input up to k=${k} where the candidate differs`;
    }
    case 'counterexample': {
      const n = differentialDetail(c)?.compared ?? null;
      return n === null
        ? 'Differential testing found an input where the candidate differs'
        : `Differential testing found an input where the candidate differs (${formatCount(n)} inputs run)`;
    }
    case 'proof-failed':
      return 'Lean proof against the agreed spec failed';
    case 'compile-error':
      return 'The candidate did not compile';
    case 'impure':
      return 'The purity check found a side effect';
    case 'not-faster':
      return 'The benchmark did not show it faster than the original';
    default:
      return `Rejected at the ${STAGE_LABEL[r.stage]} stage`;
  }
}

function believe(c: CandidateRecord, r: Rejection, n: number | null): CatchView['believe'] {
  const cx = r.counterexample;
  const concrete = cx
    ? 'The input above is concrete: call the original and the candidate with it and you get the two outputs shown. One input where they differ is enough to reject.'
    : null;
  if (r.kind === 'smt-counterexample' || (cx && cx.source === 'smt')) {
    const k = smtK(c);
    return {
      tier: 'verified-to-k',
      tierLabel: TIER_LABEL['verified-to-k'],
      sentences: [
        k === null
          ? 'Z3 searched the bounded input space for an input where the candidate and the original differ, and found one.'
          : `Z3 searched every input up to the bound k=${k} for one where the candidate and the original differ, and found one.`,
        ...(concrete ? [concrete] : []),
      ],
    };
  }
  if (r.kind === 'counterexample' || (cx && cx.source === 'differential')) {
    return {
      tier: 'tested',
      tierLabel: TIER_LABEL.tested,
      sentences: ['The differential tester ran the original and the candidate on the same inputs and compared their outputs value by value.', ...(concrete ? [concrete] : [])],
    };
  }
  if (r.kind === 'proof-failed') {
    const t = tierText('proved', { n });
    return {
      tier: 'proved',
      tierLabel: t.withheld ? 'Proof against the agreed spec (label withheld)' : t.label,
      sentences: [
        'Lean did not accept a proof that the candidate meets the agreed spec; the unsolved goal is shown.',
        'A failed proof is the absence of a proof, not a demonstration that the candidate is wrong. Without one the candidate cannot reach the proof tier, so it is not accepted.',
        ...(t.sentence ? [`About that tier: ${t.sentence}`] : [WITHHELD_NOTE]),
      ],
    };
  }
  return { tier: null, tierLabel: null, sentences: [r.reason || caughtBy(c, r)] };
}

export function catchView(c: CandidateRecord, names: string[] | null, modelChecked: number | null): CatchView | null {
  const r = c.rejection;
  if (!r) return null;
  const cx = r.counterexample ?? null;
  const differs = !!cx && !outcomeEqual(cx.original, cx.candidate);
  const given = (r.reason ?? '').trim();
  const derived = cx ? neutralReason(cx.input, cx.original, cx.candidate, names) : null;
  const reason = given || derived || caughtBy(c, r);
  const heading = differs
    ? 'Caught: the candidate differs from the original'
    : r.kind === 'proof-failed'
      ? 'Rejected: not proved against the agreed spec'
      : `Rejected at the ${STAGE_LABEL[r.stage]} stage`;
  const bench = stageOf(c, 'benchmark');
  const speedupNote = c.speedup
    ? null
    : bench && bench.status === 'pass'
      ? 'Benchmarked, but no speedup was recorded.'
      : `Not benchmarked: rejected at the ${STAGE_LABEL[r.stage]} stage, before the benchmark.`;
  return {
    candidateId: c.id,
    round: c.round,
    differs,
    heading,
    caughtBy: caughtBy(c, r),
    stage: r.stage,
    kind: r.kind,
    reason,
    reasonDerived: !given,
    counterexample: cx
      ? {
          inputs: cx.input.map((value, i) => ({ name: names && names.length === cx.input.length ? names[i]! : null, value })),
          inputLine: inputText(cx.input, names),
          original: cx.original,
          candidate: cx.candidate,
          source: cx.source,
        }
      : null,
    theorem: r.theorem ?? null,
    goal: r.goal ?? null,
    speedup: c.speedup,
    speedupNote,
    believe: believe(c, r, modelChecked),
  };
}

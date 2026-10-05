/**
 * The one place that turns a Tier into display text. "Proved" never appears without `provedSentence(N)`: when N (the
 * model-check input count) is not recorded, the label is withheld and a neutral description is shown instead.
 */
import { TIER_LABEL, provedSentence, type Tier } from '@faithful/core/tiers';

export interface TierText {
  label: string;
  /** provedSentence(N) for the proved tiers; null otherwise. */
  sentence: string | null;
  /** True when a proved tier is shown without its label because N is unknown. */
  withheld: boolean;
}

export const WITHHELD_NOTE =
  'Label withheld: no check of this Lean model against the TypeScript is recorded in this session, and the proof label is only shown with the number of inputs that check covered.';

/** Said next to the label when the model check that supplies N also found inputs where the Lean model and the TypeScript differ. */
export function mismatchNote(disagreements: number): string {
  return `In that check the Lean model and the TypeScript gave different results on ${disagreements === 1 ? 'one input' : `${disagreements.toLocaleString('en-US')} inputs`}; those inputs are not counted above.`;
}

export function isProvedTier(t: Tier | null | undefined): t is 'proved' | 'proved-trusting-compiler' {
  return t === 'proved' || t === 'proved-trusting-compiler';
}

export function tierText(tier: Tier, opts: { k?: number | null; n: number | null }): TierText {
  if (isProvedTier(tier)) {
    if (opts.n === null) {
      return {
        label: tier === 'proved' ? 'Lean proof accepted' : 'Lean proof accepted (trusting the compiler)',
        sentence: null,
        withheld: true,
      };
    }
    return { label: TIER_LABEL[tier], sentence: provedSentence(opts.n), withheld: false };
  }
  if (tier === 'verified-to-k' && typeof opts.k === 'number') return { label: `${TIER_LABEL[tier]}=${opts.k}`, sentence: null, withheld: false };
  return { label: TIER_LABEL[tier], sentence: null, withheld: false };
}

/**
 * A stage summary written by the server, safe to show: the server's proof stage says "Proved against the agreed spec in
 * 2 attempts", which would be a bare "Proved" without provedSentence(N). The tier is shown elsewhere (with its sentence
 * or withheld), so here the summary names what happened instead of the tier.
 */
export function stageSummaryText(summary: string): string {
  return summary.replace(/\bProved \(trusting the compiler\)/g, 'Lean accepted a proof (trusting the compiler)').replace(/\bProved\b/g, 'Lean accepted a proof');
}

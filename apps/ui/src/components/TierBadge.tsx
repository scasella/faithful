/**
 * A tier, in the exact vocabulary of @faithful/core/tiers. A proved tier always renders provedSentence(N) beneath it;
 * when N is unknown the "Proved" label is withheld (see lib/tierText.ts).
 */
import type { Tier } from '@faithful/core/tiers';
import { WITHHELD_NOTE, mismatchNote, tierText } from '../lib/tierText';
import { Num, ProvedSentenceText } from './Provenance';

/** `mismatches`: disagreements in the model check that supplied N (said beside the label, never hidden). */
export function TierBadge({ tier, n, k, mismatches }: { tier: Tier; n: number | null; k?: number | null; mismatches?: number | null }) {
  const t = tierText(tier, { n, k: k ?? null });
  return (
    <span class={`tier tier-${tier}`}>
      <span class="tier-label">
        {tier === 'verified-to-k' && typeof k === 'number' ? <Num what="Bound Z3 searched to (SMT stage)">{t.label}</Num> : t.label}
      </span>
      {t.sentence && n !== null && (
        <span class="tier-sentence">
          <ProvedSentenceText sentence={t.sentence} n={n} />
        </span>
      )}
      {t.sentence && n !== null && !!mismatches && <span class="tier-sentence">{mismatchNote(mismatches)}</span>}
      {t.withheld && <span class="tier-sentence">{WITHHELD_NOTE}</span>}
    </span>
  );
}

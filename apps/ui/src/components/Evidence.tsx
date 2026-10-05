/**
 * The evidence line for a candidate, built only from facts in state (lib/evidence.ts). Every number opens its
 * provenance; whenever the line says "Proved", provedSentence(N) is printed beneath it, N being this candidate's own
 * model check.
 */
import type { CandidateRecord, SessionState } from '@faithful/session';
import { evidenceFor } from '../lib/evidence';
import { Num, ProvedSentenceText } from './Provenance';

/** `provedNote={false}` only where the same card already shows provedSentence(N) (e.g. beside a TierBadge). */
export function Evidence({ state, candidate, provedNote = true }: { state: SessionState; candidate: CandidateRecord; provedNote?: boolean }) {
  const e = evidenceFor(state, candidate);
  const n = e.n;
  if (!e.clauses.length) return <p class="evidence muted">No evidence recorded yet.</p>;
  return (
    <div>
      <p class="evidence">
        {e.clauses.map((c, i) => (
          <span key={c.id} class="clause">
            {i > 0 && ' '}
            <Num what={c.what}>{c.text}</Num>
          </span>
        ))}
      </p>
      {provedNote && e.provedNote && <p class="evidence-note">{n !== null ? <ProvedSentenceText sentence={e.provedNote} n={n} /> : e.provedNote}</p>}
    </div>
  );
}

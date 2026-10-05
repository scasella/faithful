/**
 * Carve-outs, shown prominently and permanently once recorded: a band that stays at the top of the screen while it
 * scrolls. Any screen can mount it; it reads the session's carve-outs (and the agreement's, which are the same set once
 * agreed). Renders nothing when there are none.
 */
import type { SessionState } from '@faithful/session';
import type { Precondition } from '@faithful/translate';
import './agreement-parts.css';

export function carveOutsOf(s: SessionState): Precondition[] {
  const all = [...(s.agreement?.carveOuts ?? []), ...s.carveOuts];
  const seen = new Set<string>();
  return all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export function CarveOutBand({ state }: { state: SessionState }) {
  const list = carveOutsOf(state);
  if (!list.length) return null;
  return (
    <aside class="carve-band" aria-label="Carve-outs">
      <p class="carve-band-head">
        {list.length === 1 ? 'Carve-out' : 'Carve-outs'} <span class="carve-band-sub">excluded from every claim, recorded permanently</span>
      </p>
      <ul>
        {list.map((c) => (
          <li key={c.id}>
            <span>{c.words}</span>
            {c.ts && (
              <>
                {' '}
                <code class="carve-band-cond">{c.ts}</code>
              </>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

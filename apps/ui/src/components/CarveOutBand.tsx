/**
 * Carve-outs, shown prominently and permanently once recorded: a band that stays at the top of the screen while it
 * scrolls. Any screen can mount it; it reads the session's carve-outs (and the agreement's, which are the same set once
 * agreed). Renders nothing when there are none.
 *
 * `receipt`: the delivery receipt's version, placed before any speedup and above the claim: not sticky, larger, with the
 * count in words. The words are always the carve-outs' own, verbatim.
 */
import type { SessionState } from '@faithful/session';
import type { Precondition } from '@faithful/translate';
import './agreement-parts.css';

export function carveOutsOf(s: SessionState): Precondition[] {
  const all = [...(s.agreement?.carveOuts ?? []), ...s.carveOuts];
  const seen = new Set<string>();
  return all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function CarveOutBand({ state, receipt = false }: { state: SessionState; receipt?: boolean }) {
  const list = carveOutsOf(state);
  if (!list.length) return null;
  if (receipt) {
    const n = COUNT_WORDS[list.length] ?? String(list.length);
    return (
      <aside class="carve-band carve-receipt" aria-labelledby="carve-receipt-h">
        <p class="carve-band-head" id="carve-receipt-h">
          Read this before the label above
        </p>
        <p class="carve-receipt-lead">
          {n.replace(/^./, (c) => c.toUpperCase())} {list.length === 1 ? 'class of inputs was' : 'classes of inputs were'} carved out during agreement. In{' '}
          {list.length === 1 ? 'its' : 'their'} own words:
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

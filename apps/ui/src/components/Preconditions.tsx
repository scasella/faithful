/**
 * Preconditions in plain words. The Translate screen and the Agree screen (and its confirmation) render the list with
 * this one component, so the user reads exactly the same sentences before and while agreeing.
 */
import type { SessionState } from '@faithful/session';
import type { Precondition, PreconditionKind } from '@faithful/translate';
import './agreement-parts.css';

/** Short plain-words name of each kind. Never a tier, never a number. */
export const PRECONDITION_KIND_WORDS: Record<PreconditionKind, string> = {
  'int-bound': 'Integer bounds',
  bmp: 'Plain text',
  'range-ok': 'No overflow',
  ascii: 'ASCII letters',
  'no-throw': 'Does not throw',
  'carve-out': 'Carve-out',
};

/** What the throw choice adds, in words. Shown with the list while the server has not yet folded it into an agreement. */
export const NO_THROW_WORDS = 'The function does not throw on any input that meets the other preconditions (your choice: a throw is a precondition).';

export interface PreconditionView {
  items: Precondition[];
  /** A pending line the user's throw choice adds; null when it does not apply or the list already carries it. */
  throwNote: string | null;
}

/**
 * The preconditions a claim about this function will rest on, as known now: the agreement's list once agreed,
 * otherwise the translator's list plus the line the throw choice adds. Carve-outs are listed separately (CarveOutBand).
 */
export function preconditionView(s: SessionState): PreconditionView {
  if (s.agreement) return { items: s.agreement.preconditions, throwNote: null };
  const items = s.translation?.ok ? s.translation.value.preconditions : [];
  const has = items.some((p) => p.kind === 'no-throw');
  return { items, throwNote: s.throwChoice === 'precondition' && !has ? NO_THROW_WORDS : null };
}

export function Preconditions({ view, compact }: { view: PreconditionView; compact?: boolean }) {
  if (!view.items.length && !view.throwNote) return <p class="muted">No preconditions: every input of the declared types is in scope.</p>;
  return (
    <ul class="pre-list">
      {view.items.map((p) => (
        <li key={p.id} class={`pre pre-${p.kind}`}>
          <span class="pre-kind">{PRECONDITION_KIND_WORDS[p.kind]}</span>
          <span class="pre-words">{p.words}</span>
          {!compact && (p.lean || p.ts) && (
            <details class="pre-exact">
              <summary>Exact condition</summary>
              <dl class="kv">
                {p.lean && (
                  <>
                    <dt>Lean</dt>
                    <dd>
                      <code>{p.lean}</code>
                    </dd>
                  </>
                )}
                <dt>TypeScript</dt>
                <dd>
                  {p.ts ? (
                    <code>{p.ts}</code>
                  ) : p.kind === 'range-ok' ? (
                    <span class="muted">none: enforced by running the range-checked copy of your function</span>
                  ) : (
                    <span class="muted">none</span>
                  )}
                </dd>
              </dl>
            </details>
          )}
        </li>
      ))}
      {view.throwNote && (
        <li class="pre pre-no-throw">
          <span class="pre-kind">{PRECONDITION_KIND_WORDS['no-throw']}</span>
          <span class="pre-words">{view.throwNote}</span>
        </li>
      )}
    </ul>
  );
}

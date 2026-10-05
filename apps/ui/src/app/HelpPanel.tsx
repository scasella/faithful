/** The '?' panel: a non-modal list of keys. No focus trap; the page stays usable; Escape or '?' closes it. */
import { Fragment } from 'preact';
import { KeyHint } from '../components/KeyHint';

export interface KeyDoc {
  keys: string[];
  what: string;
}

export const GLOBAL_KEYS: KeyDoc[] = [
  { keys: ['←', '['], what: 'Previous stage (completed stages only)' },
  { keys: ['→', ']'], what: 'Next stage, up to the current one' },
  { keys: ['?'], what: 'Show or hide this panel' },
  { keys: ['T'], what: 'Show or hide the toolchain checks (why a tier may be unavailable)' },
  { keys: ['Esc'], what: 'Close this panel, the toolchain panel or a provenance popover' },
  { keys: ['Tab'], what: 'Move between controls; every number opens its provenance on focus' },
];

export const REPLAY_KEYS: KeyDoc[] = [
  { keys: ['p'], what: 'Play or pause the replay' },
  { keys: ['.'], what: 'Step one event' },
  { keys: ['s'], what: 'Cycle replay speed' },
  { keys: ['0'], what: 'Back to the first event' },
  { keys: ['e'], what: 'Jump to the end' },
];

export interface KeyGroup {
  title: string;
  note?: string;
  keys: KeyDoc[];
}

export function HelpPanel({ onClose, extra = [], groups = [] }: { onClose(): void; extra?: KeyDoc[]; groups?: KeyGroup[] }) {
  const all: KeyGroup[] = [{ title: 'Everywhere', keys: GLOBAL_KEYS }, ...groups, ...(extra.length ? [{ title: 'Replay', keys: extra }] : [])];
  return (
    <aside class="help" aria-label="Keyboard shortcuts">
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <h2>Keys</h2>
        <button type="button" class="btn" onClick={onClose}>
          Close <KeyHint keys="Esc" />
        </button>
      </div>
      {all.map((g) => (
        <section key={g.title} class="help-group">
          <h3 class="label">{g.title}</h3>
          {g.note && <p class="help-note">{g.note}</p>}
          <dl>
            {g.keys.map((k) => (
              <Fragment key={k.what}>
                <dt>
                  <KeyHint keys={k.keys} />
                </dt>
                <dd>{k.what}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </aside>
  );
}

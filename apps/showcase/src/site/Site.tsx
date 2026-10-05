/**
 * The showcase page: the opener (the function, already pasted, and one line), the recorded session replayed through
 * the real UI screens (apps/ui, unchanged, driven by its ReplayAdapter), the live checks, the delivered Lean file, and
 * an About text saying what is live and what is replayed.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { App } from '@ui/app/App';
import { ReplayAdapter } from '@ui/adapters/replay';
import { Code } from '@ui/components/Code';
import { createStore } from '@ui/store';
import type { StampedEvent } from '@faithful/session';
import { About } from './About';
import { LivePanel } from './LivePanel';
import { dateOf, liveInputsOf, recordedWith, type Recording, type RecordingHead } from './recording';

export const OPENER_LINE = 'This works. Let’s agree on what it does, then make it faster without changing that.';

function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function RecordingSite({ rec, head, heads, autoplay }: { rec: Recording; head: RecordingHead; heads: RecordingHead[]; autoplay: boolean }) {
  const store = useMemo(() => createStore(), [rec]);
  const replay = useMemo(() => new ReplayAdapter(rec.stampedEvents as StampedEvent[], { label: head.name, fixture: false, speed: 8 }), [rec]);
  const li = useMemo(() => liveInputsOf(rec), [rec]);
  const dev = /^DEV SAMPLE/.test(rec.notes);
  const t = rec.toolchain;
  const [leanText, setLeanText] = useState<string | null>(null);
  useEffect(() => {
    if (!head.lean) return;
    fetch(head.lean)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setLeanText)
      .catch(() => setLeanText(null));
  }, [head.lean]);

  return (
    <div class="site">
      <header class="site-head">
        <p class="kicker">Faithful · a recorded session</p>
        {heads.length > 1 && (
          <nav aria-label="Recordings">
            {heads.map((h) => (
              <a key={h.name} href={`?r=${encodeURIComponent(h.name)}`} aria-current={h.name === head.name ? 'page' : undefined}>
                {h.fn}
              </a>
            ))}
          </nav>
        )}
        <a href="#about">What is live and what is replayed</a>
      </header>

      {dev && (
        <p class="fixture-banner" role="note" data-testid="dev-sample-banner">
          <b>Dev sample.</b> {rec.notes}
        </p>
      )}

      <section class="opener" aria-labelledby="opener-h">
        <h1 id="opener-h" class="sr-only">
          {rec.fn}
        </h1>
        <Code text={rec.source} lang="ts" label={`The function ${rec.fn}, as pasted`} />
        <p class="opener-line" data-testid="opener-line">
          {OPENER_LINE}
        </p>
      </section>

      <section class="panel replayed" aria-labelledby="replay-h">
        <h2 id="replay-h">The session, replayed</h2>
        <p class="replay-label" data-testid="replay-label">
          <span class="badge replayed">replayed</span> Recorded on {dateOf(rec.recordedAt)} with {recordedWith(t)}. Every number,
          model call, Lean result and Z3 result in this panel comes from that recording; none of it runs now. Keys: p play or pause,
          . step, s speed, 0 start, e end, ? all keys.
        </p>
        <div class="replay-frame">
          <App store={store} adapter={replay} replay={replay} onAttached={() => (autoplay && !reducedMotion() ? replay.play() : undefined)} />
        </div>
      </section>

      <LivePanel li={li} />

      <section class="panel" aria-labelledby="lean-h">
        <h2 id="lean-h">The delivered Lean file</h2>
        {head.lean ? (
          <>
            <p>
              <span class="badge replayed">replayed</span> Written by the tool on {dateOf(rec.recordedAt)} and checked then by{' '}
              {t.lean.toolchain ?? 'Lean'} with Mathlib {t.lean.mathlibCommit?.slice(0, 12) ?? '(not recorded)'}; not re-checked in this
              browser. <a href={head.lean} data-testid="lean-link">{head.lean.split('/').pop()}</a> (a plain file on this site).
            </p>
            {leanText !== null ? <Code text={leanText} lang="lean" label="The delivered Lean file" /> : <p class="muted">Loading the file…</p>}
          </>
        ) : (
          <p class="muted">This session delivered no Lean file (no proof was accepted, or none was recorded with it).</p>
        )}
      </section>

      <About rec={rec} />
    </div>
  );
}

/**
 * The showcase page: the landing page (apps/ui/src/landing, variant 'showcase') in front; then the recorded sessions:
 * the menu (each recording's carve-outs named beside it), the cautions of the chosen recording (its carve-outs, verbatim,
 * and a note when it predates the spec-fault fix), the opener (the function, already pasted, and one line), the recorded session replayed through
 * the real UI screens (apps/ui, unchanged, driven by its ReplayAdapter), the live checks, the delivered Lean file, and
 * an About text saying what is live and what is replayed.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { App } from '@ui/app/App';
import { ReplayAdapter } from '@ui/adapters/replay';
import { Code } from '@ui/components/Code';
import { createStore } from '@ui/store';
import { Landing } from '@ui/landing/Landing';
import type { StampedEvent } from '@faithful/session';
import { About } from './About';
import { LivePanel } from './LivePanel';
import { SPEC_FAULT_NOTE, carveOutRemainder, dateOf, liveInputsOf, recordedWith, specFaultRuled, type LiveInputs, type Recording, type RecordingHead } from './recording';

export const OPENER_LINE = 'This works. Let’s agree on what it does, then make it faster without changing that.';

function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** A recording's limits, shown near the top of its section: carve-outs in their own words, and the spec-fault note. */
export function RecordingCautions({ name, li, specFault }: { name: string; li: LiveInputs; specFault: boolean }) {
  const carve = li.carveOuts;
  if (carve.length === 0 && !specFault) return null;
  const remainder = carveOutRemainder(name, carve, li.incumbent);
  return (
    <div class="rec-caution" role="note" data-testid="recording-caution">
      {carve.length > 0 && (
        <>
          <p>
            <b>
              Read this first: the agreed spec of this recording has {carve.length === 1 ? 'a carve-out' : `${carve.length} carve-outs`}.
            </b>{' '}
            Every label in it, including any proof, holds only outside {carve.length === 1 ? 'this input class' : 'these input classes'}:
          </p>
          <ul data-testid="carve-outs">
            {carve.map((c) => (
              <li key={c.id}>
                {c.words} <code>{c.ts}</code>
              </li>
            ))}
          </ul>
          {remainder && <p data-testid="carve-out-remainder">{remainder}</p>}
        </>
      )}
      {specFault && <p data-testid="spec-fault-note">{SPEC_FAULT_NOTE}</p>}
    </div>
  );
}

/** The short caution beside a recording's name in the menu. */
function headCaution(h: RecordingHead): string | null {
  const parts: string[] = [];
  const n = h.carveOuts?.length ?? 0;
  if (n > 0) parts.push(n === 1 ? '1 carve-out' : `${n} carve-outs`);
  if (h.specFaults) parts.push('recorded before the spec-fault fix');
  return parts.length ? parts.join('; ') : null;
}

export function RecordingSite({ rec, head, heads, autoplay }: { rec: Recording; head: RecordingHead; heads: RecordingHead[]; autoplay: boolean }) {
  const store = useMemo(() => createStore(), [rec]);
  const replay = useMemo(() => new ReplayAdapter(rec.stampedEvents as StampedEvent[], { label: head.name, fixture: false, speed: 8 }), [rec]);
  const li = useMemo(() => liveInputsOf(rec), [rec]);
  const specFault = useMemo(() => specFaultRuled(rec), [rec]);
  const dev = /^DEV SAMPLE/.test(rec.notes);
  const t = rec.toolchain;
  const [leanText, setLeanText] = useState<string | null>(null);
  // The replay sits below the landing page, so it starts when it scrolls into view (or never, with ?paused or reduced
  // motion), not on load: a visitor who scrolls down or follows "Watch a recorded session" sees it from the start.
  const frame = useRef<HTMLDivElement>(null);
  const [attached, setAttached] = useState(false);
  useEffect(() => {
    if (!attached || !autoplay || reducedMotion() || !frame.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      replay.play();
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        replay.play();
      }
    });
    io.observe(frame.current);
    return () => io.disconnect();
  }, [attached, autoplay, replay]);
  // This page renders after the recordings load, so the browser's own jump to #replay (the menu's links) has already
  // missed its target: jump once now.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  useEffect(() => {
    if (!head.lean) return;
    fetch(head.lean)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setLeanText)
      .catch(() => setLeanText(null));
  }, [head.lean]);

  return (
    <>
      <Landing variant="showcase" />
      <div class="site">
        <section id="replay" class="sessions" aria-labelledby="sessions-h">
          <header class="site-head">
            <h2 id="sessions-h" class="kicker">
              Recorded sessions
            </h2>
            {heads.length > 1 && (
              <nav aria-label="Recordings">
                {heads.map((h) => {
                  const caution = headCaution(h);
                  return (
                    <span key={h.name} class="rec-pick">
                      <a href={`?r=${encodeURIComponent(h.name)}#replay`} aria-current={h.name === head.name ? 'page' : undefined}>
                        {h.fn}
                        {/^DEV SAMPLE/.test(h.notes) ? ' (dev sample)' : ''}
                      </a>
                      {caution && (
                        <span class="rec-pick-caution" data-testid={`nav-caution-${h.name}`}>
                          {caution}
                        </span>
                      )}
                    </span>
                  );
                })}
              </nav>
            )}
            <a href="#about">What is live and what is replayed</a>
          </header>

          {dev && (
            <p class="fixture-banner" role="note" data-testid="dev-sample-banner">
              <b>Dev sample.</b> {rec.notes}
            </p>
          )}

          <RecordingCautions name={head.name} li={li} specFault={specFault} />

          <section class="opener" aria-labelledby="opener-h">
            <h3 id="opener-h" class="sr-only">
              {rec.fn}
            </h3>
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
            <div class="replay-frame" ref={frame}>
              <App store={store} adapter={replay} replay={replay} onAttached={() => setAttached(true)} />
            </div>
          </section>
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
    </>
  );
}

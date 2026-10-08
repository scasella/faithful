/**
 * Entry. Modes (query string):
 *   (none)                 live session over the local server (LiveAdapter). Opens on the app, or on the landing page
 *                          when the session cookie says so (landing/startScreen.ts; the landing's checkbox sets it).
 *                          The app opens in the Simple view (src/simple/) unless the session cookie faithful_view says
 *                          'full' (simple/viewPref.ts); "Full view" / "Simple view" switch without a reload, on the same
 *                          store and the same event-stream connection. &view=simple|full overrides the cookie once.
 *   ?mock=<name>           development fixture via ReplayAdapter, shown complete; add &play to play from the start,
 *                          &speed=<n> to set the speed (fixtures: src/fixtures/, labelled "Development fixture")
 *                          &at=<n> | <event kind>[:<k>] stops the fixture after n events, or right after the k-th (1-based,
 *                          default 1) event of that kind, e.g. &at=candidate.decided (the catch moment)
 *                          &interactive drives the fixture instead: actions are answered by releasing its next events
 *                          &view=simple shows the fixture in the Simple view (with &at, &play or &interactive too),
 *                          e.g. ?mock=catch&at=challenge.run&view=simple, or ?mock=catch&interactive&view=simple to drive
 *                          the whole Simple flow; the fixture banner stays on. Without &view the full view is shown.
 *   ?dev=gallery           every shared component plus the whole `catch` fixture session, one stage after another
 */
// Base styles first, so each screen's stylesheet (imported by its component) can refine them at equal specificity.
import './styles.css';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LiveAdapter } from './adapters/live';
import { ReplayAdapter } from './adapters/replay';
import { ScriptedAdapter } from './adapters/scripted';
import { Gallery } from './dev/Gallery';
import { Landing } from './landing/Landing';
import { currentStartScreen, type StartScreen } from './landing/startScreen';
import { FIXTURES } from './fixtures';
import { createStore } from './store';
import { Views } from './simple/Views';
import { currentView, viewFromQuery } from './simple/viewPref';
import { seekTarget } from './fixtures/seek';

const root = document.getElementById('app')!;
const q = new URLSearchParams(location.search);
const store = createStore();

if (q.get('dev') === 'gallery') {
  render(<Gallery />, root);
} else if (q.has('mock')) {
  const name = q.get('mock') ?? '';
  const fx = FIXTURES[name];
  if (!fx) {
    render(
      <main class="shell">
        <h1>Unknown fixture “{name}”</h1>
        <p class="muted">Available: {Object.keys(FIXTURES).join(', ')}.</p>
      </main>,
      root,
    );
  } else if (q.has('interactive')) {
    // Drive the fixture with the real screens and keys: every action releases the fixture's next events.
    const scripted = new ScriptedAdapter(fx.events, { label: fx.title });
    render(<Views store={store} adapter={scripted} fixtureTitle={`${fx.title} (driven)`} initial={viewFromQuery(q) ?? 'full'} />, root);
  } else {
    const speed = Number(q.get('speed') ?? '8');
    const replay = new ReplayAdapter(fx.events, { label: fx.title, fixture: true, speed: Number.isFinite(speed) && speed > 0 ? speed : 8 });
    const at = seekTarget(fx.events, q.get('at'));
    const onAttached = () => (q.has('play') ? replay.play() : at !== null ? replay.seek(at) : replay.toEnd());
    render(<Views store={store} adapter={replay} replay={replay} fixtureTitle={fx.title} onAttached={onAttached} initial={viewFromQuery(q) ?? 'full'} />, root);
  }
} else {
  render(<Live />, root);
}

/**
 * The live UI with its start screen. Leaving the app for the landing page closes the event stream (App unmounts); coming
 * back reconnects, and the server sends the whole session again, so the store is cleared first.
 */
function Live() {
  const adapter = useMemo(() => new LiveAdapter(), []);
  const [screen, setScreen] = useState<StartScreen>(currentStartScreen);
  // The whole view is replaced: name it in the title and, after a switch (not on first load), move focus into the new
  // view so keyboard and screen-reader users land in it: the landing's heading, or back on "About Faithful" in the app
  // when nothing there took focus itself.
  const first = useRef(true);
  useEffect(() => {
    document.title = screen === 'landing' ? 'Faithful: about' : 'Faithful';
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      if (screen === 'landing') document.getElementById('hero-h')?.focus();
      else if (document.activeElement === document.body) ((document.querySelector('[data-about]') ?? document.getElementById('simple-step-h')) as HTMLElement | null)?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [screen]);
  if (screen === 'landing') {
    return (
      <Landing
        variant="local"
        onEnter={() => {
          store.reset();
          setScreen('app');
          scrollTo(0, 0);
        }}
      />
    );
  }
  return (
    <Views
      store={store}
      adapter={adapter}
      initial={viewFromQuery(q) ?? currentView()}
      persist
      onAbout={() => {
        setScreen('landing');
        scrollTo(0, 0);
      }}
    />
  );
}

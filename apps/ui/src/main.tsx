/**
 * Entry. Modes (query string):
 *   (none)                 live session over the local server (LiveAdapter)
 *   ?mock=<name>           development fixture via ReplayAdapter, shown complete; add &play to play from the start,
 *                          &speed=<n> to set the speed (fixtures: src/fixtures/, labelled "Development fixture")
 *                          &at=<n> | <event kind>[:<k>] stops the fixture after n events, or right after the k-th (1-based,
 *                          default 1) event of that kind, e.g. &at=candidate.decided (the catch moment)
 *                          &interactive drives the fixture instead: actions are answered by releasing its next events
 *   ?dev=gallery           every shared component plus the whole `catch` fixture session, one stage after another
 */
// Base styles first, so each screen's stylesheet (imported by its component) can refine them at equal specificity.
import './styles.css';
import { render } from 'preact';
import { LiveAdapter } from './adapters/live';
import { ReplayAdapter } from './adapters/replay';
import { ScriptedAdapter } from './adapters/scripted';
import { App } from './app/App';
import { Gallery } from './dev/Gallery';
import { FIXTURES } from './fixtures';
import { createStore } from './store';
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
    render(<App store={store} adapter={scripted} fixtureTitle={`${fx.title} (driven)`} />, root);
  } else {
    const speed = Number(q.get('speed') ?? '8');
    const replay = new ReplayAdapter(fx.events, { label: fx.title, fixture: true, speed: Number.isFinite(speed) && speed > 0 ? speed : 8 });
    const at = seekTarget(fx.events, q.get('at'));
    const onAttached = () => (q.has('play') ? replay.play() : at !== null ? replay.seek(at) : replay.toEnd());
    render(<App store={store} adapter={replay} replay={replay} fixtureTitle={fx.title} onAttached={onAttached} />, root);
  }
} else {
  render(<App store={store} adapter={new LiveAdapter()} />, root);
}

/**
 * Showcase entry. The landing page (apps/ui/src/landing) comes first, then the recorded sessions. ?r=<name> picks a
 * recording from recordings/index.json (default: the first in RECORDING_ORDER, clamp). With no recording at all, the
 * UI's development fixture is shown instead, labelled as a development fixture (never as evidence).
 * The replay starts playing when it scrolls into view (site/Site.tsx); ?paused: never start it by itself.
 */
import '@ui/styles.css';
import './site/site.css';
import { render } from 'preact';
import { App } from '@ui/app/App';
import { ReplayAdapter } from '@ui/adapters/replay';
import { FIXTURES } from '@ui/fixtures';
import { createStore } from '@ui/store';
import { Landing } from '@ui/landing/Landing';
import { RecordingSite } from './site/Site';
import { loadIndex, loadRecording, orderHeads, type RecordingHead } from './site/recording';

const root = document.getElementById('app')!;
const q = new URLSearchParams(location.search);

function fixtureFallback(why: string) {
  const fx = FIXTURES.catch!;
  const store = createStore();
  const replay = new ReplayAdapter(fx.events, { label: fx.title, fixture: true, speed: 8 });
  render(
    <>
      <Landing variant="showcase" />
      <div class="site" id="replay">
        <p class="err-inline" role="status">
          No recording could be loaded ({why}). Showing the UI’s development fixture instead; nothing below ran.
        </p>
        <App store={store} adapter={replay} replay={replay} fixtureTitle={fx.title} onAttached={() => replay.toEnd()} />
      </div>
    </>,
    root,
  );
}

async function main() {
  let heads: RecordingHead[];
  try {
    heads = orderHeads(await loadIndex());
  } catch (e) {
    return fixtureFallback((e as Error).message);
  }
  if (heads.length === 0) return fixtureFallback('recordings/index.json lists none');
  const want = q.get('r');
  const head = heads.find((h) => h.name === want) ?? heads[0]!;
  try {
    const rec = await loadRecording(head);
    render(<RecordingSite rec={rec} head={head} heads={heads} autoplay={!q.has('paused')} />, root);
  } catch (e) {
    fixtureFallback((e as Error).message);
  }
}

void main();

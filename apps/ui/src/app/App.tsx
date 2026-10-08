/**
 * The shell: one stage per screen, the stepper above it, a non-modal key panel. A fixture banner is shown whenever the
 * events come from a hand-authored fixture, so a fixture can never be mistaken for evidence.
 */
import { useEffect } from 'preact/hooks';
import type { Adapter } from '../actions';
import type { ReplayAdapter } from '../adapters/replay';
import { STALE_TOKEN } from '../adapters/live';
import { StampContext } from '../components/context';
import { FIXTURE_DETAIL, FIXTURE_NOTICE } from '../fixtures/common';
import { useKeys } from '../lib/keys';
import { stampOf } from '../lib/provenance';
import { SCREENS, SCREEN_KEYS } from '../screens';
import { STAGES, attach, skippedStages, type Store } from '../store';
import { AppContext } from './AppContext';
import { HelpPanel, REPLAY_KEYS } from './HelpPanel';
import { JobBar } from './JobBar';
import { ToolchainPanel } from './ToolchainPanel';
import { KeyHint } from '../components/KeyHint';
import { ReplayBar } from './ReplayBar';
import { Stepper } from './Stepper';

export interface AppProps {
  store: Store;
  adapter: Adapter;
  /** Present when playing back; shows the replay bar. */
  replay?: ReplayAdapter;
  /** Present when the events are a development fixture. */
  fixtureTitle?: string;
  /** Called once after the adapter is attached (e.g. to seek a replay). */
  onAttached?(): void;
  /** Local UI only: shows the landing page again ("About Faithful" in the top bar). Absent in replays and the showcase. */
  onAbout?(): void;
  /** Local UI and dev fixtures only: switches to the Simple view ("Simple view" in the top bar). Absent in the showcase. */
  onSimple?(): void;
}

export function FixtureBanner({ title }: { title?: string }) {
  return (
    <p class="fixture-banner" role="note">
      <b>{FIXTURE_NOTICE}.</b> {title ? `${title}. ` : ''}
      {FIXTURE_DETAIL}
    </p>
  );
}

export function Shell({ store, adapter, replay, fixtureTitle, onAbout, onSimple }: Omit<AppProps, 'onAttached'>) {
  const s = store.state.value;
  const shown = store.shown.value;
  const Screen = SCREENS[shown];
  const label = STAGES.find((x) => x.id === shown)!.label;
  const current = STAGES.find((x) => x.id === s.stage)!.label;
  const conn = store.connection.value;

  const anyPanel = store.helpOpen.value || store.toolchainOpen.value;
  useKeys({
    prev: () => store.move(-1),
    next: () => store.move(1),
    '?': () => (store.helpOpen.value = !store.helpOpen.value),
    T: () => (store.toolchainOpen.value = !store.toolchainOpen.value),
    Escape: anyPanel
      ? () => {
          store.helpOpen.value = false;
          store.toolchainOpen.value = false;
        }
      : undefined,
  });

  return (
    <AppContext.Provider value={{ store, adapter }}>
      <StampContext.Provider value={stampOf(s)}>
        <div class="shell">
          {fixtureTitle !== undefined && <FixtureBanner title={fixtureTitle} />}
          {replay && <ReplayBar replay={replay} />}
          <header class="topbar" style={{ marginTop: 'var(--s4)' }}>
            <h1>Faithful</h1>
            {s.fn && (
              <span class="fn">
                {s.fn}
                {s.file ? ` · ${s.file}` : ' · pasted'}
              </span>
            )}
            <span class="topbar-tools">
              {onSimple && (
                <button type="button" class="btn" data-simple onClick={onSimple}>
                  Simple view
                </button>
              )}{' '}
              {onAbout && (
                <button type="button" class="btn" data-about onClick={onAbout}>
                  About Faithful
                </button>
              )}{' '}
              <button type="button" class="btn" aria-keyshortcuts="T" aria-pressed={store.toolchainOpen.value} onClick={() => (store.toolchainOpen.value = !store.toolchainOpen.value)}>
                Toolchain <KeyHint keys="T" />
              </button>
            </span>
          </header>
          <Stepper current={s.stage} shown={shown} onGo={(x) => store.go(x)} skipped={skippedStages(s)} />
          <JobBar />
          {!replay && conn.kind === 'open' && conn.note && (
            <p class="conn-note" role="status">
              {conn.note}
            </p>
          )}
          <main class="screen" aria-labelledby="screen-title">
            <div class="screen-title">
              <h2 id="screen-title">{label}</h2>
              {shown !== s.stage && (
                <span class="muted">
                  Completed stage. The session is at {current}.{' '}
                  <button type="button" class="linklike" onClick={() => store.go(null)}>
                    Go to {current}
                  </button>
                </span>
              )}
            </div>
            {store.actionError.value && (
              <p class="err-inline" role="alert" style={{ marginBottom: 'var(--s4)' }}>
                {store.actionError.value}
              </p>
            )}
            <Screen />
          </main>
          {!replay && conn.kind !== 'open' && (
            <p class="conn" role="status" style={{ marginTop: 'var(--s6)' }}>
              {conn.kind === 'connecting' && 'Connecting to the local server…'}
              {conn.kind === 'retrying' && conn.error === STALE_TOKEN && (
                <>
                  The local server does not accept this page any more (it was probably restarted; it makes a new token each time).{' '}
                  <button type="button" class="linklike" onClick={() => location.reload()}>
                    Reload the page
                  </button>{' '}
                  to see the session it has.
                </>
              )}
              {conn.kind === 'retrying' && conn.error !== STALE_TOKEN && `Event stream interrupted (${conn.error}); retrying in ${Math.round(conn.inMs / 100) / 10} s.`}
              {conn.kind === 'closed' && 'Disconnected.'}
            </p>
          )}
          {store.toolchainOpen.value && <ToolchainPanel onClose={() => (store.toolchainOpen.value = false)} />}
          {store.helpOpen.value && <HelpPanel onClose={() => (store.helpOpen.value = false)} extra={replay ? REPLAY_KEYS : []}
              groups={[
                {
                  title: `This screen: ${label}`,
                  note: replay ? 'In a replay these actions are disabled; the replay keys below apply instead.' : undefined,
                  keys: SCREEN_KEYS[shown],
                },
              ]} />}
        </div>
      </StampContext.Provider>
    </AppContext.Provider>
  );
}

export function App(props: AppProps) {
  const { store, adapter, onAttached } = props;
  useEffect(() => {
    const off = attach(store, adapter);
    onAttached?.();
    return off;
  }, [store, adapter]);
  return <Shell {...props} />;
}

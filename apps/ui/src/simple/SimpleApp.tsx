/**
 * The Simple view: the critical flow, one question or one primary action per screen, in one centred column.
 * Same Store, Adapter and attach() as the full App, so it runs live, over a ReplayAdapter fixture and driven by the
 * ScriptedAdapter. Steps (flow.ts): Pick → Translate → Agree → Prove → Faster → Result (Tested-only: four of them).
 * Everything else (every attempt, chip and model prompt) is in the full view, one click away ("Full view").
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Adapter } from '../actions';
import { AppContext } from '../app/AppContext';
import { FixtureBanner } from '../app/App';
import { STALE_TOKEN } from '../adapters/live';
import { StampContext } from '../components/context';
import { stampOf } from '../lib/provenance';
import { attach, type Store } from '../store';
import { pickMark, proofKey, progressText, screenId, simpleStep, stillPicking, type PickMark } from './flow';
import { DELIVERED_ID, H1_ID } from './parts';
import { PickStep } from './PickStep';
import { TranslateStep } from './TranslateStep';
import { AgreeStep } from './AgreeStep';
import { ProveStep } from './ProveStep';
import { FasterStep } from './FasterStep';
import { ResultStep } from './ResultStep';
import './simple.css';

export interface SimpleProps {
  store: Store;
  adapter: Adapter;
  /** Present when the events are a development fixture: the fixture banner is shown, always. */
  fixtureTitle?: string;
  /** Present where the full view exists: shows "Full view" in the header. */
  onFull?(): void;
  /** Called once after the adapter is attached (SimpleApp only), e.g. to seek a replay. */
  onAttached?(): void;
}

export function SimpleShell({ store, adapter, fixtureTitle, onFull }: Omit<SimpleProps, 'onAttached'>) {
  const s = store.state.value;
  const events = store.events.value;
  const [pickFrom, setPickFrom] = useState<PickMark | null>(null);
  const [continued, setContinued] = useState<string | null>(null);
  const picking = stillPicking(pickFrom, events);
  const key = proofKey(s);
  const step = simpleStep(s, { picking, continueUnproved: key !== null && continued === key });
  const conn = store.connection.value;

  // When the screen changes (not on first render), focus its heading so keyboard and screen-reader users land in it.
  // The screen is finer than the step (screenId): a new disagreement, the confirmation, a running proof or the delivered
  // files replace the button that had focus just as a new step does. After delivery the heading stays, so the focus
  // goes to the delivered block instead.
  const screen = picking ? 'pick' : screenId(s, step);
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (prev.current !== null && prev.current !== screen) {
      const target = (screen === 'result:delivered' && document.getElementById(DELIVERED_ID)) || document.getElementById(H1_ID);
      target?.focus({ preventScroll: screen === 'result:delivered' });
      if (screen !== 'result:delivered' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    }
    prev.current = screen;
  }, [screen]);

  const pickAnother = () => {
    store.actionError.value = null;
    setPickFrom(pickMark(events));
  };

  return (
    <AppContext.Provider value={{ store, adapter }}>
      <StampContext.Provider value={stampOf(s)}>
        <div class="simple">
          {fixtureTitle !== undefined && <FixtureBanner title={fixtureTitle} />}
          <header class="s-head">
            <span class="s-mark">faithful</span>
            {s.fn && step !== 'pick' && <span class="s-fn">{s.fn}</span>}
            <span class="s-progress">{progressText(s, step, picking)}</span>
            {onFull && (
              <button type="button" class="s-link" data-full onClick={onFull}>
                Full view
              </button>
            )}
          </header>
          {adapter.readOnly === false && conn.kind === 'open' && conn.note && (
            <p class="s-conn" role="status">
              {conn.note}
            </p>
          )}
          <main class="s-main" aria-labelledby={H1_ID}>
            {step === 'pick' && <PickStep picking={picking} />}
            {step === 'translate' && <TranslateStep onPickAnother={pickAnother} />}
            {step === 'agree' && <AgreeStep onPickAnother={pickAnother} />}
            {step === 'prove' && <ProveStep onContinue={() => setContinued(key)} />}
            {step === 'faster' && <FasterStep onPickAnother={pickAnother} />}
            {step === 'result' && <ResultStep onPickAnother={pickAnother} />}
          </main>
          {!adapter.readOnly && conn.kind !== 'open' && (
            <p class="s-conn" role="status">
              {conn.kind === 'connecting' && 'Connecting to the local server…'}
              {conn.kind === 'retrying' && conn.error === STALE_TOKEN && (
                <>
                  The local server does not accept this page any more (it was probably restarted).{' '}
                  <button type="button" class="s-link" onClick={() => location.reload()}>
                    Reload the page
                  </button>
                </>
              )}
              {conn.kind === 'retrying' && conn.error !== STALE_TOKEN && `Event stream interrupted (${conn.error}); retrying in ${Math.round(conn.inMs / 100) / 10} s.`}
              {conn.kind === 'closed' && 'Disconnected.'}
            </p>
          )}
        </div>
      </StampContext.Provider>
    </AppContext.Provider>
  );
}

/** The Simple view with its own connection: attaches the adapter to the store on mount. */
export function SimpleApp(props: SimpleProps) {
  const { store, adapter, onAttached } = props;
  useEffect(() => {
    const off = attach(store, adapter);
    onAttached?.();
    return off;
  }, [store, adapter]);
  return <SimpleShell {...props} />;
}

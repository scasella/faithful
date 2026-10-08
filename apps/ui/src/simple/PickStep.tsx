/**
 * Step 1, Pick: one search field over the repository's exported functions; "or paste a function" behind a disclosure.
 * The server ranks every function of the repository by what Faithful can attempt (Actions.pickFunctions, from its
 * background scan; the hook is ../screens/select/pickView.ts) and the first screen leads with the best eight. The ones it
 * can't run are listed apart behind a toggle, with the reason, and cannot be opened. Replays and fixtures list the
 * functions locally, without statuses.
 */
import { useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { pastedName, type FnHit } from '../screens/select/match';
import { usePickView } from '../screens/select/pickView';
import { openable, rowKey, useSelection } from '../screens/select/runnable';
import { CannotRun, RowStatus, ScanAnnouncer, ScanLine } from '../screens/select/CannotRun';
import { act } from '../store';
import { blockingJob } from '../components/ActionButton';
import { jobWords } from '../lib/job';
import { Actions, SButton, StepHead } from './parts';

export const PICK_LIMIT = 8;
const OPEN_JOBS = ['open'] as const;

/**
 * `picking`: the person asked to pick another function; the session in the store is still the previous one, so its
 * failed jobs are not shown here (only a failure to open the new function is: `job.started` clears the old one).
 */
export function PickStep({ onOpened, picking }: { onOpened?(): void; picking?: boolean }) {
  const { store, adapter } = useApp();
  const s = store.state.value;
  if (adapter.readOnly) {
    return (
      <section class="s-step">
        <StepHead lead={s.fn ? <>This replay is about <code>{s.fn}</code>{s.file ? <> in <code>{s.file}</code></> : ' (pasted)'}.</> : 'No function has been chosen yet in this replay.'}>
          Which function should get faster?
        </StepHead>
        <Actions />
      </section>
    );
  }
  return <Picker onOpened={onOpened} picking={picking} />;
}

function Picker({ onOpened, picking }: { onOpened?(): void; picking?: boolean }) {
  const { store, adapter } = useApp();
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState('');
  const [pasteFn, setPasteFn] = useState('');

  const view = usePickView(adapter, query, PICK_LIMIT);
  // the highlight is the row's identity: when the server re-ranks the list as the scan advances, it stays on the same function
  const { shown, cannot } = view;
  const sel = useSelection(shown);
  const hits = shown.map((r) => r.hit);
  const cur = sel.cur;

  const busy = () => {
    const job = blockingJob(store);
    if (!job) return false;
    store.actionError.value = `Wait until the running job finishes (${jobWords(job).toLowerCase()}), then choose a function.`;
    return true;
  };
  const open = (h: FnHit) => {
    if (view.stale) return; // the rows answer an older query: wait for the answer to this one
    // a row still being checked is not a choice yet (the list is about to be re-ranked under the pointer)
    const at = hits.indexOf(h);
    if (at < 0 || !openable(shown[at]!)) return;
    if (busy()) return;
    void act(store, () => adapter.openFunction(h.path, h.name)).then(() => {
      if (!store.actionError.value) onOpened?.();
    });
  };
  const usePaste = () => {
    if (!paste.trim() || busy()) return;
    void act(store, () => adapter.pasteFunction(paste, pasteFn.trim() || undefined)).then(() => {
      if (!store.actionError.value) onOpened?.();
    });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel.step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel.step(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const h = hits[cur];
      if (h) open(h);
    }
  };
  const guessed = pastedName(paste);

  return (
    <section class="s-step">
      <StepHead lead="Faithful looks for a faster version and says exactly what was checked.">Which function should get faster?</StepHead>
      <div class="s-field">
        <label for="s-q" class="sr-only">
          Find an exported function
        </label>
        <input
          id="s-q"
          class="s-input"
          type="search"
          role="combobox"
          autocomplete="off"
          spellcheck={false}
          placeholder="Search functions or files"
          aria-autocomplete="list"
          aria-expanded={hits.length > 0}
          aria-controls="s-results"
          aria-activedescendant={cur >= 0 ? `s-opt-${cur}` : undefined}
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            sel.clear();
          }}
          onKeyDown={onKey}
        />
      </div>
      {view.phase === 'failed' ? (
        <p class="s-err" role="alert">
          Could not list the repository's functions: {view.failure}. You can paste a function instead.
        </p>
      ) : view.phase === 'listing' ? (
        <p class="s-note" role="status">
          Listing exported functions…
        </p>
      ) : hits.length === 0 ? (
        <>
          {view.cannotTotal === 0 && (
            <p class="s-note" role="status">
              {view.emptyRepo ? 'No exported functions were found in this repository.' : 'No exported function matches.'} You can paste one instead.
            </p>
          )}
          <ScanLine line={view.scanLine} />
          <CannotRun rows={cannot} total={view.cannotTotal} only available={view.statuses} id="s-cannot" />
        </>
      ) : (
        <>
          <ul id="s-results" role="listbox" class={`s-results${view.stale ? ' stale' : ''}`} aria-label="Matching functions" aria-busy={view.stale}>
            {shown.map(({ hit: h, state }, i) => (
              <li
                key={rowKey(h)}
                id={`s-opt-${i}`}
                role="option"
                aria-selected={i === cur}
                aria-disabled={openable({ state }) ? undefined : true}
                class={`${i === cur ? 'on' : ''}${openable({ state }) ? '' : ' wait'}`.trim() || undefined}
                onMouseMove={() => sel.select(i)}
                onClick={() => open(h)}
              >
                <span class="s-res-name">{h.name}</span>
                <span class="s-res-path">
                  {h.path}:{h.line}
                </span>
                <RowStatus state={state} />
              </li>
            ))}
          </ul>
          {view.note && <p class="s-note">{view.note}</p>}
          <ScanLine line={view.scanLine} />
          <CannotRun rows={cannot} total={view.cannotTotal} only={false} available={view.statuses} id="s-cannot" />
        </>
      )}
      <ScanAnnouncer text={view.announce} active={view.statuses} />
      {view.askError && (
        <p class="s-err" role="alert">
          Could not refresh the list: {view.askError}. The rows shown may be out of date.
        </p>
      )}
      {view.degraded && view.phase === 'ready' && (
        <p class="s-note">Could not ask which functions Faithful can run ({view.degraded}); every function is listed, without a status.</p>
      )}
      <Actions errorJobs={picking ? OPEN_JOBS : undefined} />
      <details class="s-details">
        <summary>or paste a function</summary>
        <div class="s-details-body">
          <label for="s-paste" class="s-label">
            One TypeScript function
          </label>
          <textarea id="s-paste" class="s-area" rows={8} spellcheck={false} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} />
          <label for="s-paste-fn" class="s-label">
            Function name <span class="s-note-inline">(only needed if the paste declares several)</span>
          </label>
          <input
            id="s-paste-fn"
            class="s-input"
            type="text"
            spellcheck={false}
            placeholder={guessed ?? ''}
            value={pasteFn}
            onInput={(e) => setPasteFn((e.target as HTMLInputElement).value)}
          />
          <div class="s-buttons">
            <SButton disabled={!paste.trim()} why="Paste a function first" run={usePaste} local>
              Use this function
            </SButton>
          </div>
          <p class="s-note">Nothing is written to your repository.</p>
        </div>
      </details>
    </section>
  );
}

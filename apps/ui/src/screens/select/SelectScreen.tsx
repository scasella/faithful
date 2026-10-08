/**
 * Select: pick an exported function (a typeahead the server ranks, see ./pickView.ts) or paste one. Nothing else is on this screen.
 * Keys: '/' focuses the search, ↑/↓ move through matches, Enter opens, 'p' switches to pasting (Mod+Enter submits a paste).
 * Matches are ranked by the server by what Faithful can attempt (Actions.pickFunctions, from its background scan of the
 * whole repository; the list re-ranks in place as the scan advances); the ones it can't run are listed apart, with the
 * reason, and cannot be opened. ↑/↓/Enter move only through the runnable list. A replay or fixture lists the functions
 * locally (Actions.listFiles), without statuses.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import { Code } from '../../components/Code';
import { ActionButton } from '../../components/ActionButton';
import { KeyHint } from '../../components/KeyHint';
import { act, type Store } from '../../store';
import { blockingJob } from '../../components/ActionButton';
import { jobWords } from '../../lib/job';
import { useKeys } from '../../lib/keys';
import { pastedName, type FnHit } from './match';
import { usePickView } from './pickView';
import { openable, rowKey, useSelection } from './runnable';
import { CannotRun, RowStatus, ScanAnnouncer, ScanLine } from './CannotRun';
import './select.css';

export const CLI_FORM = 'faithful optimize <file> --fn <name>';
/** Rows listed at most. */
export const SELECT_LIMIT = 50;

function Name({ hit }: { hit: FnHit }) {
  if (!hit.nameHits.length) return <>{hit.name}</>;
  const on = new Set(hit.nameHits);
  return (
    <>
      {[...hit.name].map((ch, i) => (on.has(i) ? <b key={i}>{ch}</b> : ch))}
    </>
  );
}

function CliHint() {
  return (
    <p class="sel-cli">
      Command-line form: <code>{CLI_FORM}</code>
    </p>
  );
}

export function SelectScreen() {
  const { store, adapter } = useApp();
  const s = store.state.value;

  if (adapter.readOnly) {
    return (
      <div class="stack-l sel">
        {s.fn ? (
          <section class="stack">
            <p>
              This session is about <code>{s.fn}</code> {s.file ? <>in <code>{s.file}</code></> : '(pasted)'}.
            </p>
            <Code text={s.source} lang="ts" label={`Source of ${s.fn}`} />
          </section>
        ) : (
          <p class="muted">No function has been chosen yet in this replay.</p>
        )}
        <p class="muted">Replay: choosing a function is not available, nothing runs.</p>
      </div>
    );
  }
  return <Picker current={s.fn ? { fn: s.fn, file: s.file } : null} />;
}

function Picker({ current }: { current: { fn: string; file: string } | null }) {
  const { store, adapter } = useApp();
  const [mode, setMode] = useState<'find' | 'paste'>('find');
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState('');
  const [pasteFn, setPasteFn] = useState('');
  const [opening, setOpening] = useState<{ what: string; from: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Autofocus only when choosing is the task. Revisiting Select during a session must not capture the stage keys
    // ([ ] ← →) in the search field; '/' focuses it on demand.
    if (current && mode === 'find') return;
    (mode === 'find' ? input.current : area.current)?.focus();
  }, [mode]);

  const view = usePickView(adapter, query, SELECT_LIMIT);
  // the highlight is the row's identity: when the server re-ranks the list as the scan advances, it stays on the same function
  const { shown, cannot } = view;
  const sel = useSelection(shown);
  const hits = shown.map((r) => r.hit);
  const act_ = sel.cur;

  const rowOpenable = (i: number) => !!shown[i] && openable(shown[i]!);
  const open = (h: FnHit) => {
    if (view.stale) return; // the rows answer an older query: wait for the answer to this one
    // a row still being checked is not a choice yet (the list is about to be re-ranked under the pointer)
    if (!rowOpenable(hits.indexOf(h))) return;
    if (refuseWhileBusy(store)) return;
    setOpening({ what: `${h.name} in ${h.path}`, from: store.events.value.length });
    void act(store, () => adapter.openFunction(h.path, h.name)).then(() => {
      if (store.actionError.value) setOpening(null);
    });
  };
  const usePaste = async () => {
    const src = paste.trim();
    if (!src) return;
    const name = pasteFn.trim() || undefined;
    setOpening({ what: name ?? pastedName(src) ?? 'the pasted function', from: store.events.value.length });
    try {
      await adapter.pasteFunction(paste, name);
    } catch (e) {
      setOpening(null);
      throw e;
    }
  };
  // The open job can fail after it was accepted (job.failed): then the "Opening" line goes; the job line says why.
  const openFailed = opening !== null && store.events.value.slice(opening.from).some((e) => e.event.kind === 'job.failed' && e.event.job === 'open');

  useKeys({ '/': mode === 'find' ? () => input.current?.focus() : undefined });

  // the page scrolls to the highlighted row only after the person moved it with the arrow keys: never because a re-rank
  // changed which row is the best one (nothing is focused or scrolled by an update)
  const moved = useRef(false);
  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moved.current = true;
      sel.step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moved.current = true;
      sel.step(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const h = hits[act_];
      if (h) open(h);
    } else if (e.key === 'Escape') {
      if (query) {
        e.preventDefault();
        setQuery('');
        sel.clear();
      } else (e.target as HTMLInputElement).blur();
    }
  };
  // keyed on the highlighted function, not its position, and only after an arrow key moved it
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    document.getElementById(`sel-opt-${act_}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [sel.curKey]);

  const guessed = pastedName(paste);

  return (
    <div class="stack-l sel">
      {current && (
        <p class="muted">
          Current session: <code>{current.fn}</code>
          {current.file ? <> in <code>{current.file}</code></> : ' (pasted)'}. Choosing a function starts a new session.
        </p>
      )}
      {opening && !openFailed && (
        <p role="status" class="sel-opening">
          Opening {opening.what}. The translator runs next; no model is called.
        </p>
      )}

      {mode === 'find' ? (
        <section class="stack">
          <label for="sel-q" class="sel-label">
            Find an exported function <KeyHint keys="/" />
          </label>
          <input
            id="sel-q"
            ref={input}
            class="sel-input"
            type="text"
            role="combobox"
            autocomplete="off"
            spellcheck={false}
            placeholder="Function or file name"
            aria-autocomplete="list"
            aria-expanded={hits.length > 0}
            aria-controls="sel-list"
            aria-activedescendant={act_ >= 0 ? `sel-opt-${act_}` : undefined}
            aria-describedby="sel-help"
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              sel.clear();
            }}
            onKeyDown={onSearchKey}
          />
          <p id="sel-help" class="sel-help">
            <KeyHint keys={['↑', '↓']} /> move · <KeyHint keys="Enter" /> open · <KeyHint keys="Esc" /> clear
          </p>
          {view.phase === 'failed' ? (
            <p class="err-inline" role="alert">
              Could not list the repository's functions: {view.failure}. You can paste a function instead.
            </p>
          ) : view.phase === 'listing' ? (
            <p class="muted" role="status">
              Listing exported functions…
            </p>
          ) : hits.length === 0 ? (
            <>
              {view.cannotTotal === 0 && (
                <p class="muted" role="status">
                  {view.emptyRepo ? 'No exported functions were found in this repository.' : 'No exported function matches.'} You can paste one instead.
                </p>
              )}
              <ScanLine line={view.scanLine} />
              <CannotRun rows={cannot} total={view.cannotTotal} only available={view.statuses} id="sel-cannot" />
            </>
          ) : (
            <>
              <ul id="sel-list" role="listbox" class={`sel-list${view.stale ? ' stale' : ''}`} aria-label="Matching functions" aria-busy={view.stale}>
                {shown.map(({ hit: h, state }, i) => (
                  <li
                    key={rowKey(h)}
                    id={`sel-opt-${i}`}
                    role="option"
                    aria-selected={i === act_}
                    aria-disabled={openable({ state }) ? undefined : true}
                    class={`${i === act_ ? 'on' : ''}${openable({ state }) ? '' : ' wait'}`.trim() || undefined}
                    onMouseMove={() => sel.select(i)}
                    onClick={() => open(h)}
                  >
                    <span class="sel-name">
                      <Name hit={h} />
                    </span>
                    <span class="sel-path">
                      {h.path}:{h.line}
                    </span>
                    <RowStatus state={state} />
                  </li>
                ))}
              </ul>
              {view.note && <p class="sel-help">{view.note}</p>}
              <ScanLine line={view.scanLine} />
              <CannotRun rows={cannot} total={view.cannotTotal} only={false} available={view.statuses} id="sel-cannot" />
            </>
          )}
          <ScanAnnouncer text={view.announce} active={view.statuses} />
          {view.askError && (
            <p class="err-inline" role="alert">
              Could not refresh the list: {view.askError}. The rows shown may be out of date.
            </p>
          )}
          {view.degraded && view.phase === 'ready' && (
            <p class="sel-help">Could not ask which functions Faithful can run ({view.degraded}); every function is listed, without a status.</p>
          )}
          <div class="row">
            <ActionButton local keyName="p" run={() => setMode('paste')}>
              Paste a function instead
            </ActionButton>
          </div>
        </section>
      ) : (
        <section class="stack">
          <label for="sel-paste" class="sel-label">
            Paste one TypeScript function
          </label>
          <textarea
            id="sel-paste"
            ref={area}
            class="sel-area"
            rows={10}
            spellcheck={false}
            value={paste}
            aria-describedby="sel-paste-help"
            onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!refuseWhileBusy(store)) void act(store, usePaste);
              } else if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
            }}
          />
          <p id="sel-paste-help" class="sel-help">
            <KeyHint keys={['⌘ Enter', 'Ctrl Enter']} /> use it · <KeyHint keys="Esc" /> leave the field. Nothing is written to your repository.
          </p>
          <div class="sel-fn">
            <label for="sel-paste-fn">Function name</label>
            <input
              id="sel-paste-fn"
              class="sel-input"
              type="text"
              spellcheck={false}
              placeholder={guessed ?? 'only needed if the paste declares several'}
              value={pasteFn}
              onInput={(e) => setPasteFn((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="row">
            <ActionButton primary keyName="u" disabled={!paste.trim()} run={usePaste}>
              Use pasted function
            </ActionButton>
            <ActionButton local keyName="p" run={() => setMode('find')}>
              Back to the function list
            </ActionButton>
          </div>
        </section>
      )}
      <CliHint />
    </div>
  );
}

/** Opening starts a server job; while another runs the server answers 423, so say so here instead of asking. */
function refuseWhileBusy(store: Store): boolean {
  const job = blockingJob(store);
  if (!job) return false;
  store.actionError.value = `Wait until the running job finishes (${jobWords(job).toLowerCase()}), then choose a function.`;
  return true;
}

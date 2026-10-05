/**
 * Select: pick an exported function (typeahead over Actions.listFiles()) or paste one. Nothing else is on this screen.
 * Keys: '/' focuses the search, ↑/↓ move through matches, Enter opens, 'p' switches to pasting (Mod+Enter submits a paste).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import type { FileEntry } from '../../actions';
import { Code } from '../../components/Code';
import { ActionButton } from '../../components/ActionButton';
import { KeyHint } from '../../components/KeyHint';
import { act, type Store } from '../../store';
import { blockingJob } from '../../components/ActionButton';
import { jobWords } from '../../lib/job';
import { useKeys } from '../../lib/keys';
import { matchFunctions, pastedName, type FnHit } from './match';
import './select.css';

export const CLI_FORM = 'faithful optimize <file> --fn <name>';

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
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'find' | 'paste'>('find');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [paste, setPaste] = useState('');
  const [pasteFn, setPasteFn] = useState('');
  const [opening, setOpening] = useState<{ what: string; from: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    adapter.listFiles().then(
      (f) => (setFiles(f), setListErr(null)),
      (e: Error) => setListErr(e.message || String(e)),
    );
  }, [adapter]);
  useEffect(() => {
    // Autofocus only when choosing is the task. Revisiting Select during a session must not capture the stage keys
    // ([ ] ← →) in the search field; '/' focuses it on demand.
    if (current && mode === 'find') return;
    (mode === 'find' ? input.current : area.current)?.focus();
  }, [mode]);

  const { hits, total } = useMemo(() => matchFunctions(files ?? [], query), [files, query]);
  const act_ = Math.min(active, Math.max(0, hits.length - 1));

  const open = (h: FnHit) => {
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

  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(act_ + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(act_ - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const h = hits[act_];
      if (h) open(h);
    } else if (e.key === 'Escape') {
      if (query) {
        e.preventDefault();
        setQuery('');
        setActive(0);
      } else (e.target as HTMLInputElement).blur();
    }
  };
  useEffect(() => {
    document.getElementById(`sel-opt-${act_}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [act_]);

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
            aria-activedescendant={hits.length ? `sel-opt-${act_}` : undefined}
            aria-describedby="sel-help"
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setActive(0);
            }}
            onKeyDown={onSearchKey}
          />
          <p id="sel-help" class="sel-help">
            <KeyHint keys={['↑', '↓']} /> move · <KeyHint keys="Enter" /> open · <KeyHint keys="Esc" /> clear
          </p>
          {listErr !== null ? (
            <p class="err-inline" role="alert">
              Could not list the repository's functions: {listErr}. You can paste a function instead.
            </p>
          ) : files === null ? (
            <p class="muted" role="status">
              Listing exported functions…
            </p>
          ) : hits.length === 0 ? (
            <p class="muted" role="status">
              {files.length === 0 ? 'No exported functions were found in this repository.' : 'No exported function matches.'} You can paste one instead.
            </p>
          ) : (
            <>
              <ul id="sel-list" role="listbox" class="sel-list" aria-label="Matching functions">
                {hits.map((h, i) => (
                  <li
                    key={`${h.path}:${h.name}:${h.line}`}
                    id={`sel-opt-${i}`}
                    role="option"
                    aria-selected={i === act_}
                    class={i === act_ ? 'on' : undefined}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => open(h)}
                  >
                    <span class="sel-name">
                      <Name hit={h} />
                    </span>
                    <span class="sel-path">
                      {h.path}:{h.line}
                    </span>
                  </li>
                ))}
              </ul>
              {total > hits.length && (
                <p class="sel-help">
                  {total.toLocaleString('en-US')} functions match; the first {hits.length} are listed. Keep typing to narrow.
                </p>
              )}
            </>
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

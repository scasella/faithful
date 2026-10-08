/**
 * Small shared pieces of the Simple view: the button (ActionButton's rules without key bindings or key chips), the
 * action area (buttons, then the job line, the inline error and the replay note, in that order), the step heading
 * (the one h1, focus target when the step changes) and the compact carve-out list placed next to any label it limits.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { carveOutsOf } from '../components/CarveOutBand';
import { blockingJob } from '../components/ActionButton';
import { jobWords } from '../lib/job';
import { act } from '../store';
import type { SessionState } from '@faithful/session';

export const H1_ID = 'simple-step-h';
/** The delivered block of the Result step: focus target once the delivery is written (the heading stays the same). */
export const DELIVERED_ID = 'simple-delivered';

export function StepHead({ children, lead }: { children: ComponentChildren; lead?: ComponentChildren }) {
  return (
    <header class="s-step-head">
      <h1 id={H1_ID} tabIndex={-1}>
        {children}
      </h1>
      {lead && <p class="s-lead">{lead}</p>}
    </header>
  );
}

export interface SButtonProps {
  children: ComponentChildren;
  run(): Promise<void> | void;
  primary?: boolean;
  disabled?: boolean;
  /** Does not call the backend (page-local): allowed in replays and while a job runs. */
  local?: boolean;
  /** Stays enabled while a job runs (the server accepts it then, e.g. Stop). */
  whileBusy?: boolean;
  /** Why it is disabled, when `disabled` is set by the caller. */
  why?: string;
}

/** A button for an Actions call. Disabled in replays and while another job runs, with the reason in its title. */
export function SButton({ children, run, primary, disabled, local, whileBusy, why }: SButtonProps) {
  const { store, adapter } = useApp();
  const [busy, setBusy] = useState(false);
  const job = local || whileBusy ? null : blockingJob(store);
  const off = !!disabled || busy || (adapter.readOnly && !local) || job !== null;
  const title =
    adapter.readOnly && !local ? 'Replay: nothing runs, actions are disabled' : job !== null ? `Waiting: ${jobWords(job)} is running` : disabled ? why : undefined;
  const go = async () => {
    if (off) return;
    if (local) return void run();
    setBusy(true);
    await act(store, async () => {
      await run();
    });
    setBusy(false);
  };
  return (
    <button type="button" class={`s-btn${primary ? ' primary' : ''}`} disabled={off} title={title} onClick={() => void go()}>
      {children}
    </button>
  );
}

/**
 * Where a step's buttons go. Under them, in one quiet line each: the running job, the last failed job, the last action
 * error (store.actionError), and in a replay that nothing runs. `note`: a quiet sentence under the buttons. `column`: the
 * buttons are answers to the step's question, stacked full width. `errorJobs`: show the last failed job only when it is one
 * of these (Pick, while picking another function, must not show the previous session's failure).
 */
export function Actions({
  children,
  note,
  column,
  errorJobs,
}: {
  children?: ComponentChildren;
  note?: ComponentChildren;
  column?: boolean;
  errorJobs?: readonly string[];
}) {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const { running, lastError } = s.job;
  const err = store.actionError.value;
  return (
    <div class="s-actions">
      {children && <div class={`s-buttons${column ? ' s-answers' : ''}`}>{children}</div>}
      {note && <p class="s-note">{note}</p>}
      {running && (
        <p class="s-job" role="status" aria-live="polite">
          <span class="s-dot" aria-hidden="true" />
          {jobWords(running)}…
        </p>
      )}
      {lastError && !running && (!errorJobs || errorJobs.includes(lastError.job)) && (
        <p class="s-err" role="alert">
          {jobWords(lastError.job)} failed: {lastError.message}
        </p>
      )}
      {err && (
        <p class="s-err" role="alert">
          {err}
        </p>
      )}
      {adapter.readOnly && <p class="s-note">This is a replay: nothing runs, so the buttons are disabled.</p>}
    </div>
  );
}

/** Carve-outs, verbatim, in a compact box: shown beside every label they limit. Nothing when there are none. */
export function CarveOuts({ s, lead }: { s: SessionState; lead?: string }) {
  const list = carveOutsOf(s);
  if (!list.length) return null;
  return (
    <aside class="s-carves" aria-label="Carve-outs">
      <p class="s-carves-head">{lead ?? (list.length === 1 ? 'Carve-out: every label here excludes these inputs' : 'Carve-outs: every label here excludes these inputs')}</p>
      <ul>
        {list.map((c) => (
          <li key={c.id}>{c.words}</li>
        ))}
      </ul>
    </aside>
  );
}

/** The one quiet disclosure of a step. */
export function Details({ children, summary = 'Details' }: { children: ComponentChildren; summary?: string }) {
  return (
    <details class="s-details">
      <summary>{summary}</summary>
      <div class="s-details-body">{children}</div>
    </details>
  );
}

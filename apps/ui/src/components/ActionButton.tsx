/**
 * A button for an Actions-port call, with its key bound and shown. In a replay it is disabled and says why.
 * While the server runs a job (`SessionState.job.running`) every action that would start another is disabled and says
 * which job is running (the server would answer 423); `whileBusy` marks the few that stay available (Stop).
 * Failures appear inline (store.actionError, and the session's job.lastError), never in a modal.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { act, type Store } from '../store';
import { jobWords } from '../lib/job';
import { useKeys } from '../lib/keys';
import { KeyHint } from './KeyHint';

export interface ActionButtonProps {
  children: ComponentChildren;
  /** Single key that triggers it, e.g. 'a'. */
  keyName: string;
  run(): Promise<void> | void;
  primary?: boolean;
  disabled?: boolean;
  /** Does not call the backend (e.g. opens the Agree confirmation): allowed in replays. */
  local?: boolean;
  /** Stays enabled while a job runs (the server accepts it then, e.g. Stop). */
  whileBusy?: boolean;
}

/** The running job's name when it blocks backend actions, else null. */
export function blockingJob(store: Store): string | null {
  return store.state.value.job.running;
}

export function ActionButton({ children, keyName, run, primary, disabled, local, whileBusy }: ActionButtonProps) {
  const { store, adapter } = useApp();
  const [busy, setBusy] = useState(false);
  const job = local || whileBusy ? null : blockingJob(store);
  const off = disabled || busy || (adapter.readOnly && !local) || job !== null;
  const go = async () => {
    if (off) return;
    if (local) return void run();
    setBusy(true);
    await act(store, async () => {
      await run();
    });
    setBusy(false);
  };
  useKeys({ [keyName]: off ? undefined : () => void go() });
  const title = adapter.readOnly && !local ? 'Replay: nothing runs, actions are disabled' : job !== null ? `Waiting: ${jobWords(job)} is running` : undefined;
  return (
    <button type="button" class={`btn${primary ? ' primary' : ''}`} disabled={off} aria-keyshortcuts={keyName} title={title} onClick={() => void go()}>
      {children} <KeyHint keys={keyName} />
    </button>
  );
}

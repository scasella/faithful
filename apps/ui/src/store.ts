/**
 * The UI store. The only source of truth is the event list; SessionState is `reduce` over it (incrementally while
 * events append, from scratch on reset). Screens read `state.value`; they never mutate it.
 */
import { batch, computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { initialState, reduce, type SessionEvent, type SessionState, type StageName, type StampedEvent } from '@faithful/session';
import type { Adapter, ConnectionStatus } from './actions';

export const STAGES: Array<{ id: StageName; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'translate', label: 'Translate' },
  { id: 'agree', label: 'Agree' },
  { id: 'prove', label: 'Prove original' },
  { id: 'optimize', label: 'Optimize' },
  { id: 'deliver', label: 'Deliver' },
];

export const stageIndex = (s: StageName): number => STAGES.findIndex((x) => x.id === s);

export interface Store {
  events: Signal<StampedEvent[]>;
  state: Signal<SessionState>;
  /** The stage the user is looking at; null follows the session's current stage. */
  viewing: Signal<StageName | null>;
  shown: ReadonlySignal<StageName>;
  connection: Signal<ConnectionStatus>;
  helpOpen: Signal<boolean>;
  /** The Toolchain panel (key T). */
  toolchainOpen: Signal<boolean>;
  /** Last action error, shown inline (never as a modal). */
  actionError: Signal<string | null>;
  push(e: StampedEvent | SessionEvent): void;
  reset(events?: Array<StampedEvent | SessionEvent>): void;
  /** Can the user navigate to this stage? The current stage and completed ones. */
  reachable(s: StageName): boolean;
  go(s: StageName | null): void;
  /** Move by -1/+1 among reachable stages. */
  move(dir: -1 | 1): void;
}

function stamped(e: StampedEvent | SessionEvent, seq: number): StampedEvent {
  return 'event' in e ? e : { seq, t: 0, event: e };
}

export function createStore(): Store {
  const events = signal<StampedEvent[]>([]);
  const state = signal<SessionState>(initialState());
  const viewing = signal<StageName | null>(null);
  const connection = signal<ConnectionStatus>({ kind: 'connecting' });
  const helpOpen = signal(false);
  const toolchainOpen = signal(false);
  const actionError = signal<string | null>(null);
  const shown = computed<StageName>(() => {
    const v = viewing.value;
    return v !== null && stageIndex(v) <= stageIndex(state.value.stage) ? v : state.value.stage;
  });

  const store: Store = {
    events,
    state,
    viewing,
    shown,
    connection,
    helpOpen,
    toolchainOpen,
    actionError,
    push(e) {
      const se = stamped(e, events.value.length);
      batch(() => {
        events.value = [...events.value, se];
        state.value = reduce(state.value, se.event);
      });
    },
    reset(list = []) {
      const ses = list.map((e, i) => stamped(e, i));
      batch(() => {
        events.value = ses;
        state.value = ses.reduce((s, e) => reduce(s, e.event), initialState());
        viewing.value = null;
      });
    },
    reachable(s) {
      return stageIndex(s) <= stageIndex(state.value.stage);
    },
    go(s) {
      viewing.value = s === null || s === state.value.stage ? null : s;
    },
    move(dir) {
      const i = stageIndex(shown.value) + dir;
      const target = STAGES[i];
      if (target && store.reachable(target.id)) store.go(target.id);
    },
  };
  return store;
}

/** Wire an adapter's event stream into a store. Returns the disconnect function. */
export function attach(store: Store, adapter: Adapter): () => void {
  return adapter.connect(
    (e) => store.push(e),
    (s) => (store.connection.value = s),
    () => store.reset(),
  );
}

/** Run an action, reporting a failure inline. */
export async function act(store: Store, f: () => Promise<void>): Promise<void> {
  store.actionError.value = null;
  try {
    await f();
  } catch (e) {
    store.actionError.value = (e as Error).message;
  }
}

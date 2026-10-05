/**
 * The Actions port: everything the UI can ask the backend to do. The UI calls these; adapters implement them.
 *   - LiveAdapter (adapters/live.ts): HTTP to the local `faithful` server. Route table: apps/ui/API.md.
 *   - ReplayAdapter (adapters/replay.ts): plays a recorded or fixture event list; actions are refused (read-only).
 *
 * Every action resolves when the backend has ACCEPTED it, not when the work is done. Progress and results arrive only as
 * SessionEvents on the event stream; the UI never shows a result that did not come from an event.
 */
import type { StampedEvent, Threshold } from '@faithful/session';

export interface FileEntry {
  path: string;
  functions: Array<{ name: string; line: number; hasJsDoc: boolean }>;
}

/**
 * A class of inputs the server can carve out, from the deterministic menu `GET /api/challenge/carve-options` returns for
 * one disagreement (packages/cli/src/flow/carveout.ts). The server writes the Lean and TypeScript predicates; neither the
 * user nor the model writes a carve-out condition.
 */
export type CarveClass =
  | { param: number; kind: 'negative' | 'zero' | 'positive' | 'equals' }
  | { param: number; kind: 'empty' | 'length-equals' }
  | { param: number; kind: 'exact-input' };

export interface CarveOption {
  cls: CarveClass;
  /** What is excluded, in plain words (server text). */
  excluded: string;
}

/** A ruling as the UI submits it. The server pins `specHash` to the current proposal and builds any carve-out itself. */
export type RulingInput =
  | { ruling: 'spec-wrong'; note?: string }
  | { ruling: 'function-wrong'; then: 'fix-original'; note?: string }
  | { ruling: 'function-wrong'; then: 'carve-out'; carve: CarveClass; note?: string };

/** One line of `GET /api/doctor` (packages/cli/src/doctor.ts). */
export interface DoctorCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

export interface ProveBudget {
  maxAttempts: number;
  minutes: number;
}

export interface Actions {
  listFiles(): Promise<FileEntry[]>;
  openFunction(file: string, fn: string): Promise<void>;
  pasteFunction(source: string, fn?: string): Promise<void>;
  chooseThrow(choice: 'precondition' | 'spec-case'): Promise<void>;
  proposeSpec(): Promise<void>;
  reviseSpec(): Promise<void>;
  rerunChallenge(): Promise<void>;
  /** The carve-out classes offered for one disagreement (read-only; not a job). */
  carveOptions(challengeId: string): Promise<CarveOption[]>;
  rule(challengeId: string, ruling: RulingInput): Promise<void>;
  agree(): Promise<void>;
  proveOriginal(budget: ProveBudget): Promise<void>;
  startOptimize(threshold: Threshold): Promise<void>;
  /**
   * A function the translator refused: continue on the Tested tier only (no spec, proof or SMT check exists for it).
   * `specials`: also generate NaN, Infinity, -Infinity and -0 as inputs (opt-in).
   */
  startTestedOnly(threshold: Threshold, opts?: { specials?: boolean }): Promise<void>;
  acceptFasterNotProved(candidateId: number): Promise<void>;
  stopOptimize(): Promise<void>;
  deliver(): Promise<void>;
  /** The toolchain checks (`faithful doctor`): why a tier may be unavailable. Read-only. */
  doctor(): Promise<DoctorCheck[]>;
}

/**
 * Where events come from. `connect` calls `onEvent` for every event in order, starting from the beginning; `onReset`
 * (replays only) means "forget what you have, events will be re-delivered from the start". Returns a disconnect function.
 */
export interface EventSourcePort {
  connect(onEvent: (e: StampedEvent) => void, onStatus?: (s: ConnectionStatus) => void, onReset?: () => void): () => void;
}

export type ConnectionStatus =
  | { kind: 'connecting' }
  /** `note`: something the page should say once, e.g. that the server restarted and the page was reset. */
  | { kind: 'open'; note?: string }
  | { kind: 'retrying'; inMs: number; error: string }
  | { kind: 'closed' };

export interface Adapter extends Actions, EventSourcePort {
  /** True for replays: action controls are shown disabled with the reason. */
  readonly readOnly: boolean;
  readonly label: string;
}

export class ReadOnlyError extends Error {
  constructor(what: string) {
    super(`${what} is not available: this is a replay, nothing runs.`);
    this.name = 'ReadOnlyError';
  }
}

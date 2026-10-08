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

/**
 * Can the Tested path run the open function? `{ ok: false, reason }` (plain words) when it never can, for example a file
 * that imports another module (the sandbox needs a self-contained file); null when unknown (a replay, a fixture).
 */
export type TestedCheck = { ok: true } | { ok: false; reason: string } | null;

/**
 * What Faithful can ATTEMPT for one exported function (`POST /api/functions/status`, packages/cli/src/flow/triage.ts):
 *   - 'provable': the translator accepts it (a proof can be attempted; nothing is proved by this);
 *   - 'tested': refused by the translator, but the Tested tier can run it;
 *   - 'none': neither, `reason` says why in plain words;
 *   - 'unknown': not decided yet (the check ran out of time or failed); shown as not checked yet, never hidden.
 * It describes what can be attempted, never a result.
 */
export interface FunctionStatus {
  tier: 'provable' | 'tested' | 'none' | 'unknown';
  reason: string | null;
  /** 'tested': module-level declarations the extracted unit carries besides the function. */
  included?: string[];
}

/** file -> (function name -> status); a file the server could not read maps to null. */
export type FunctionStatuses = Record<string, Record<string, FunctionStatus> | null>;

/** At most this many files per `functionStatus` call (the server refuses more). */
export const STATUS_MAX_FILES = 20;

/**
 * One function of a Pick answer (`POST /api/functions/pick`, packages/cli/src/flow/scan.ts): what Faithful can attempt for
 * it, decided by the server's background scan of the whole repository. Same tiers as `FunctionStatus`; 'unknown' says why in
 * `reason` (not reached by the scan yet, took longer than the per-function cap, or the check itself failed). An overloaded
 * function is one row per (file, name), at its lowest line. Describes what can be attempted, never a result.
 */
export interface PickRow {
  file: string;
  name: string;
  line: number;
  hasJsDoc: boolean;
  tier: 'provable' | 'tested' | 'none' | 'unknown';
  reason: string | null;
}

/** The background scan's progress. `version` moves whenever a ranking could change (the page re-asks when it does). */
export interface ScanStatus {
  state: 'idle' | 'running' | 'done';
  /** Files whose statuses are decided (all of them when `done`). */
  filesDone: number;
  filesTotal: number;
  version: number;
}

/**
 * The Pick list as the server ranks it over EVERY exported function of the repository: `rows` are the best `limit` matches
 * (provable, then tested, then not decided; never one Faithful can't run). `totalMatches` and `counts` are over all matches,
 * not just the rows. `cannotRun` (with reasons, at most 200) only when asked for. `scan`: progress, so the page can re-rank
 * as it advances.
 */
export interface PickResult {
  rows: PickRow[];
  totalMatches: number;
  counts: { provable: number; tested: number; unknown: number; none: number };
  cannotRun: PickRow[];
  scan: ScanStatus;
}

/** `limit`: rows at most (server default 8, at most PICK_MAX_LIMIT). `includeUnrunnable`: also list the functions Faithful can't run. */
export interface PickOptions {
  limit?: number;
  includeUnrunnable?: boolean;
}

/** The server's cap on `limit`. */
export const PICK_MAX_LIMIT = 50;

export interface ProveBudget {
  maxAttempts: number;
  minutes: number;
}

export interface Actions {
  listFiles(): Promise<FileEntry[]>;
  /**
   * What Faithful can attempt for the exported functions of these files (at most STATUS_MAX_FILES; read-only, not a
   * job). The pick lists no longer use it (the server ranks them: `pickFunctions`); kept for the route's own readers.
   * Null: unknown (a replay, a fixture).
   */
  functionStatus(files: string[]): Promise<FunctionStatuses | null>;
  /**
   * The repository's matching functions ranked by the SERVER over everything its background scan knows (read-only, not a
   * job; the first call starts the scan). Null: unknown (a replay, a fixture); the pick lists then list `listFiles()`
   * locally, without a status.
   */
  pickFunctions(query: string, o?: PickOptions): Promise<PickResult | null>;
  /** The scan's progress (cheap; the page polls it while it runs). Null: unknown. */
  scanStatus(): Promise<ScanStatus | null>;
  /** Asks for a new scan pass (idempotent and cheap: statuses are cached by file content hash). Null: unknown. */
  startScan(): Promise<ScanStatus | null>;
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
  /** The server's preflight for `startTestedOnly` (read-only; not a job). Null: unknown. */
  testedCheck(): Promise<TestedCheck>;
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

/**
 * The background scan of the repository and the server-side ranking of the Pick list.
 *
 * Why: the Pick list used to rank only the first matches in search order, so on a large repository the empty query's
 * first screen could show functions Faithful can only test while over a thousand provable ones sat further down. Here the
 * server learns what Faithful can run for EVERY exported function of the repository, in the background, and ranks over all
 * of it; the page asks `POST /api/functions/pick` and re-asks while the scan runs.
 *
 * Passes (one per start; a later start re-checks only what changed, by content hash):
 *   1. list the repository (`listFiles`), on this thread: a few hundred milliseconds for a thousand files.
 *   2. 'quick': per file, the translator's verdict for each exported function (a worker, no sandbox): after this every
 *      provable function is known, which is what the first screen leads with.
 *   3. 'full': per file with functions the translator refused, the Tested preflight for each (workers, each owning a
 *      sandbox). Files the user's last queries match come first (`prioritize`), then files with documented functions.
 *   4. a file whose check itself failed (a worker died) is tried once more; a function over the time cap is NOT retried:
 *      it is 'unknown' with the reason "took longer than 3 seconds", for as long as its content stays the same.
 *
 * Low priority: the work goes to the pool's 'low' queue, and the scan pauses between units while a session job runs
 * (`isBusy`; call `poke()` when that changes), so it never competes with a measurement.
 *
 * Read-only and bounded: it writes nothing anywhere, never throws (an unreadable or unparseable file is that file's
 * 'unknown', never a failed scan), and keeps only paths, content hashes and statuses (no file text). At most
 * `MAX_FILES` files and `MAX_FUNCTIONS` functions are tracked.
 */
import { hashText } from '@faithful/core';
import { listFiles, type FileEntry } from './files.js';
import {
  TriageTimeout,
  classifyText,
  failedStatus,
  getOwn,
  pendingStatus,
  quickText,
  readRepoFile,
  slowStatus,
  unknownCause,
  type ExportedFn,
  type FunctionTier,
  type TriageBackend,
  type TriageDeps,
} from './triage.js';

export const MAX_FILES = 2000;
export const MAX_FUNCTIONS = 60_000;
export const DEFAULT_PICK_LIMIT = 8;
export const MAX_PICK_LIMIT = 50;
/** At most this many rows in `cannotRun`. */
export const CANNOT_RUN_MAX = 200;
/** How many files of the user's latest matches the scan does first. */
const PRIORITY_FILES = 24;
/** A start within this many ms of the last finish does not scan again (the page asks again on every focus). */
export const FRESH_MS = 5000;
/**
 * `pick` starts a new pass when the last one finished longer ago than this, so a file edited while the page stays open (in
 * the same window, by another program) is noticed without a focus event. A pass over an unchanged repository is a listing
 * and a hash of every file (about 0.7 s of background work, a few ms of event-loop time), never a classification.
 */
export const PICK_MAX_AGE_MS = 15_000;

export interface ScanStatus {
  state: 'idle' | 'running' | 'done';
  /** Files whose statuses are decided (a file that changed counts as undecided until the pass has dealt with it; all of them when `done`). */
  filesDone: number;
  filesTotal: number;
  /** Increases whenever a ranking could change (a listing change, a file decided): the page re-asks when it moves. */
  version: number;
}

export interface PickRow {
  file: string;
  name: string;
  line: number;
  hasJsDoc: boolean;
  tier: FunctionTier;
  reason: string | null;
}

export interface PickResult {
  rows: PickRow[];
  /** Every function matching the query, whatever its tier. */
  totalMatches: number;
  /** Matches by tier, over ALL matches (not just the rows). */
  counts: { provable: number; tested: number; unknown: number; none: number };
  /** Matches Faithful cannot run, with reasons; only when asked for (`includeUnrunnable`), at most CANNOT_RUN_MAX. */
  cannotRun: PickRow[];
  scan: ScanStatus;
}

export interface PickOptions {
  limit?: number;
  includeUnrunnable?: boolean;
}

/** The status of one function as the scan keeps it (no `included`: the list does not need it). */
interface Light {
  tier: FunctionTier;
  reason: string | null;
}

interface FileState {
  path: string;
  /** Hash of the text the statuses were computed from; null before the file was read. */
  hash: string | null;
  fns: ExportedFn[];
  /** Decided statuses by function name; a name without one is not reached yet. */
  status: Map<string, Light>;
  stage: 'listed' | 'quick' | 'done' | 'failed';
  /** Passes in which the check itself failed for this content. */
  failures: number;
  /** Cannot be read from inside the repository: not part of the list. */
  unreadable: boolean;
}

export interface ScannerOptions {
  repoRoot: string;
  backend: TriageBackend;
  /** Per-function cap the backend applies (for the deps handed to the triage functions). Default 3000. */
  capMs?: number;
  sample?: boolean;
  /** Files processed at once (default 2: the pool's size). */
  concurrency?: number;
  /** True while a session job runs: the scan waits between units. */
  isBusy?: () => boolean;
  /** Replaces `listFiles` (tests). */
  list?: (repoRoot: string) => Promise<FileEntry[]>;
  now?: () => number;
}

/**
 * How a query matches a function. Same rule, same ranks as the page's own typeahead (apps/ui/src/screens/select/match.ts
 * `rank`, which this copies: the server cannot import from an app): 0 exact name, 1 name prefix, 2 name contains,
 * 3 several words each in the path or name, 4 path contains, 5 letters of the name in order. null: no match.
 */
export function matchRank(q: string, name: string, path: string): number | null {
  if (!q) return 0;
  const n = name.toLowerCase();
  const p = path.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((x) => p.includes(x) || n.includes(x))) return 3;
  if (p.includes(q)) return 4;
  let j = 0;
  for (let k = 0; k < n.length && j < q.length; k++) if (n[k] === q[j]) j++;
  return j === q.length ? 5 : null;
}

const TIER_ORDER: Record<FunctionTier, number> = { provable: 0, tested: 1, unknown: 2, none: 3 };

interface Match {
  file: string;
  name: string;
  line: number;
  hasJsDoc: boolean;
  tier: FunctionTier;
  reason: string | null;
  /** 0 exact name, 1 name prefix, 2 name contains, 3 anything else that matched (path, several words, letters in order). */
  group: number;
}

/** tier (provable, tested, unknown, none), then name match (exact, prefix, contains, other), then documented first, path, line. */
export function compareMatches(a: Match, b: Match): number {
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    a.group - b.group ||
    Number(b.hasJsDoc) - Number(a.hasJsDoc) ||
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
    a.line - b.line
  );
}

export class RepoScanner {
  private readonly files = new Map<string, FileState>();
  private readonly deps: TriageDeps;
  private readonly concurrency: number;
  private readonly now: () => number;
  private state: ScanStatus['state'] = 'idle';
  private version = 0;
  private finishedAt: number | null = null;
  private running: Promise<void> | null = null;
  private listed: Promise<void>;
  private resolveListed!: () => void;
  private prio: string[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;
  /** Files whose check failed in this pass (asked once more at its end). */
  private readonly failedThisPass = new Set<string>();

  constructor(private readonly opts: ScannerOptions) {
    // the scan waits between chunks of a file's functions too (not only between files) while a session job runs
    this.deps = { backend: opts.backend, capMs: opts.capMs, sample: opts.sample, priority: 'low', beforeChunk: () => this.whenIdle() };
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.now = opts.now ?? Date.now;
    this.listed = new Promise<void>((r) => (this.resolveListed = r));
  }

  status(): ScanStatus {
    let total = 0;
    let done = 0;
    for (const f of this.files.values()) {
      if (f.unreadable) continue;
      total++;
      // a file whose check failed again is dealt with once the pass is over: its functions say "the check itself failed"
      if (f.stage === 'done' || (f.stage === 'failed' && this.state === 'done')) done++;
    }
    return { state: this.state, filesDone: done, filesTotal: total, version: this.version };
  }

  /**
   * Start a pass unless one is running or one finished less than `maxAgeMs` ago. Idempotent. A pass over an unchanged
   * repository is quick (every file is a cache hit) and changes nothing; a changed file is classified again.
   */
  start(o: { maxAgeMs?: number } = {}): ScanStatus {
    if (this.closed || this.running) return this.status();
    const age = this.finishedAt === null ? Infinity : this.now() - this.finishedAt;
    if (age < (o.maxAgeMs ?? FRESH_MS)) return this.status();
    this.state = 'running';
    this.failedThisPass.clear();
    this.running = this.pass().finally(() => {
      this.running = null;
    });
    return this.status();
  }

  /** Resolves when the pass in progress (if any) has finished. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Files the scan does next, before the rest (the most recent call wins). Unknown paths are ignored. */
  prioritize(paths: string[]): void {
    this.prio = paths.filter((p) => this.files.has(p));
  }

  /** Something that `isBusy` reads changed: let a waiting scan look again. */
  poke(): void {
    if (this.opts.isBusy?.()) return;
    const w = this.waiters.splice(0);
    for (const r of w) r();
  }

  close(): void {
    this.closed = true;
    for (const r of this.waiters.splice(0)) r();
    this.resolveListed();
  }

  /**
   * The ranked Pick list for `query`, over every function the scan knows. Starts the scan if none ran (and again when
   * the last one finished more than `PICK_MAX_AGE_MS` ago, so a changed file is noticed). Waits for the first listing only.
   */
  async pick(query: string, o: PickOptions = {}): Promise<PickResult> {
    const limit = Math.min(MAX_PICK_LIMIT, Math.max(1, Math.floor(o.limit ?? DEFAULT_PICK_LIMIT)));
    this.start({ maxAgeMs: PICK_MAX_AGE_MS });
    await this.listed;
    const q = query.trim().toLowerCase();
    const all: Match[] = [];
    const counts = { provable: 0, tested: 0, unknown: 0, none: 0 };
    for (const fs of this.files.values()) {
      if (fs.unreadable) continue;
      for (const fn of fs.fns) {
        const r = matchRank(q, fn.name, fs.path);
        if (r === null) continue;
        const st = fs.status.get(fn.name) ?? pendingStatus();
        counts[st.tier]++;
        all.push({ file: fs.path, name: fn.name, line: fn.line, hasJsDoc: fn.hasJsDoc, tier: st.tier, reason: st.reason, group: Math.min(r, 3) });
      }
    }
    all.sort(compareMatches);
    const row = (m: Match): PickRow => ({ file: m.file, name: m.name, line: m.line, hasJsDoc: m.hasJsDoc, tier: m.tier, reason: m.reason });
    const runnable = all.filter((m) => m.tier !== 'none');
    // the scan does the files of the best matches that it has not decided yet first
    const pending = all
      .filter((m) => m.tier === 'unknown' && unknownCause(m) === 'pending')
      .sort((a, b) => a.group - b.group || Number(b.hasJsDoc) - Number(a.hasJsDoc) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line);
    if (pending.length) this.prioritize([...new Set(pending.map((m) => m.file))].slice(0, PRIORITY_FILES));
    return {
      rows: runnable.slice(0, limit).map(row),
      totalMatches: all.length,
      counts,
      cannotRun: o.includeUnrunnable ? all.filter((m) => m.tier === 'none').slice(0, CANNOT_RUN_MAX).map(row) : [],
      scan: this.status(),
    };
  }

  // ───────────────────────────── the pass ─────────────────────────────

  private async pass(): Promise<void> {
    try {
      await this.relist();
      this.resolveListed();
      await this.runPhase((f) => !f.unreadable, (p) => this.quickOne(p));
      // a file whose functions the translator refused: the Tested preflight for each
      await this.runPhase((f) => !f.unreadable && (f.stage === 'quick' || (f.stage === 'failed' && f.failures < MAX_FAILURES)), (p) => this.fullOne(p));
      // a file whose check itself failed (a worker died) is tried once more, after everything else was decided
      await this.runPhase((f) => f.stage === 'failed' && f.failures < MAX_FAILURES && this.failedThisPass.has(f.path), (p) => this.fullOne(p));
    } catch {
      // the scan never fails: whatever was decided stays, the rest stays 'not checked yet'
    } finally {
      this.resolveListed();
      this.state = 'done';
      this.finishedAt = this.now();
    }
  }

  private async relist(): Promise<void> {
    let listing: FileEntry[];
    try {
      listing = await (this.opts.list ?? listFiles)(this.opts.repoRoot);
    } catch {
      return; // keep what is known; the next pass lists again
    }
    let changed = false;
    const seen = new Set<string>();
    let nFns = 0;
    for (const f of listing.slice(0, MAX_FILES)) {
      if (nFns + f.functions.length > MAX_FUNCTIONS) continue;
      nFns += f.functions.length;
      seen.add(f.path);
      const have = this.files.get(f.path);
      if (!have) {
        this.files.set(f.path, { path: f.path, hash: null, fns: f.functions, status: new Map(), stage: 'listed', failures: 0, unreadable: false });
        changed = true;
      } else {
        have.unreadable = false;
        if (!sameFns(have.fns, f.functions)) {
          have.fns = f.functions;
          changed = true;
        }
      }
    }
    for (const p of [...this.files.keys()]) {
      if (!seen.has(p)) {
        this.files.delete(p);
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  /**
   * Run `task` over the files `want` selects, `concurrency` at a time: the user's latest matches first, then files with
   * documented functions, then by path.
   */
  private async runPhase(want: (f: FileState) => boolean, task: (path: string) => Promise<void>): Promise<void> {
    const paths = [...this.files.values()].filter(want).map((f) => f.path);
    const remaining = new Set(paths);
    const sorted = [...paths].sort((a, b) => Number(!this.files.get(a)!.fns.some((f) => f.hasJsDoc)) - Number(!this.files.get(b)!.fns.some((f) => f.hasJsDoc)) || (a < b ? -1 : a > b ? 1 : 0));
    let at = 0;
    const take = (): string | undefined => {
      for (const p of this.prio) if (remaining.delete(p)) return p;
      while (at < sorted.length) {
        const p = sorted[at++]!;
        if (remaining.delete(p)) return p;
      }
      return undefined;
    };
    const lane = async (): Promise<void> => {
      for (let p = take(); p !== undefined && !this.closed; p = take()) {
        await this.whenIdle();
        if (this.closed) return;
        try {
          await task(p);
        } catch {
          // one file never ends the pass
        }
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, lane));
  }

  /** Wait while a session job runs. */
  private async whenIdle(): Promise<void> {
    while (!this.closed && this.opts.isBusy?.()) {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(t);
          const i = this.waiters.indexOf(finish);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve();
        };
        const t = setTimeout(finish, 1000);
        t.unref?.();
        this.waiters.push(finish);
      });
    }
  }

  private async read(fs: FileState): Promise<{ text: string; hash: string } | null> {
    try {
      const text = await readRepoFile(this.opts.repoRoot, fs.path);
      return { text, hash: hashText(text) };
    } catch {
      // outside the repository, not TypeScript, too large, or gone: not part of the list (the next pass looks again)
      if (!fs.unreadable) {
        fs.unreadable = true;
        this.version++;
      }
      return null;
    }
  }

  private markFailed(fs: FileState, hash: string): void {
    if (fs.hash !== hash) {
      fs.hash = hash;
      fs.status = new Map();
    }
    for (const f of fs.fns) if (!fs.status.has(f.name)) fs.status.set(f.name, failedStatus());
    fs.stage = 'failed';
    fs.failures++;
    this.failedThisPass.add(fs.path);
    this.version++;
  }

  /** The translator's verdicts for a file's current text: provable functions are decided, the rest wait for the preflight. */
  private async quickOne(path: string): Promise<void> {
    const fs = this.files.get(path);
    if (!fs) return;
    const r = await this.read(fs);
    if (!r) return;
    // unchanged since an earlier pass: what was decided stands (a failed file is asked again by the next phase, within its limit)
    if (fs.hash === r.hash && fs.stage !== 'listed') return;
    try {
      const q = await quickText(r.text, this.deps, r.hash);
      this.applyQuick(fs, r.hash, q.fns, q.verdicts);
    } catch (e) {
      // the cheap pass over this file gave up (it kept silent for too long): every function of it says so, and it is not
      // asked again while the file stays the same. Any other failure is the check itself failing (asked once more).
      if (e instanceof TriageTimeout) this.markSlow(fs, r.hash, e.ms);
      else this.markFailed(fs, r.hash);
    }
  }

  /** The cheap pass over a file ran past its budget: its functions are 'unknown, took longer than ...', decided for this content. */
  private markSlow(fs: FileState, hash: string, ms: number): void {
    fs.hash = hash;
    fs.status = new Map();
    for (const f of fs.fns) fs.status.set(f.name, slowStatus(ms));
    fs.stage = 'done';
    this.version++;
  }

  private applyQuick(fs: FileState, hash: string, fns: ExportedFn[], verdicts: Record<string, string>): void {
    fs.hash = hash;
    fs.fns = fns;
    fs.status = new Map();
    let pending = 0;
    for (const f of fns) {
      if (getOwn(verdicts, f.name) === 'provable') fs.status.set(f.name, { tier: 'provable', reason: null });
      else pending++;
    }
    fs.stage = pending ? 'quick' : 'done';
    this.version++;
  }

  /** The Tested preflight for the functions the translator refused (the whole file's statuses come back, cached by hash). */
  private async fullOne(path: string): Promise<void> {
    const fs = this.files.get(path);
    if (!fs) return;
    const r = await this.read(fs);
    if (!r) return;
    if (fs.hash === r.hash && fs.stage === 'done') return;
    try {
      const rec = await classifyText(r.text, this.deps, r.hash);
      const q = await quickText(r.text, this.deps, r.hash);
      const status = new Map<string, Light>();
      let failed = false;
      for (const f of q.fns) {
        const st = getOwn(rec, f.name) ?? failedStatus();
        if (unknownCause(st) === 'failed') failed = true;
        status.set(f.name, { tier: st.tier, reason: st.reason });
      }
      fs.hash = r.hash;
      fs.fns = q.fns;
      fs.status = status;
      if (failed) {
        fs.stage = 'failed';
        fs.failures++;
        this.failedThisPass.add(fs.path);
      } else fs.stage = 'done';
      this.version++;
    } catch (e) {
      if (e instanceof TriageTimeout) this.markSlow(fs, r.hash, e.ms);
      else this.markFailed(fs, r.hash);
    }
  }
}

/** A file whose check itself failed is asked again in later passes, at most this many times in all. */
const MAX_FAILURES = 3;

function sameFns(a: ExportedFn[], b: ExportedFn[]): boolean {
  return a.length === b.length && a.every((f, i) => f.name === b[i]!.name && f.line === b[i]!.line && f.hasJsDoc === b[i]!.hasJsDoc);
}

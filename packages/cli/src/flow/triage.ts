/**
 * Triage: which exported functions can Faithful run at all, so the Pick list can lead with them. Read-only; it never
 * opens a session, never calls a model, never runs Lean, never writes anywhere.
 *
 * Per function, strongest first:
 *   - 'provable': the deterministic translator accepts it (`translate`, exactly what `SessionRuntime.openFunction` runs).
 *     Reported even when the Tested checks would pass too: the strongest wins, and they are not run.
 *   - 'tested': refused by the translator, and the Tested tier's own preflight passes (`testedPreflight` in
 *     ./testedOriginal.ts, the same check GET /api/tested/check and `startTestedOnly` make): on the extracted unit (the
 *     function plus the module declarations it needs), or the whole file when extraction refuses, inputs can be generated
 *     from the signature, the original compiles, loads in the isolated sandbox for real, and (unless `sample: false`)
 *     does not fail on every input of a first generated sample.
 *   - 'none': neither; `reason` says why in plain words (the preflight's first sentence, from packages/session/src/tested.ts,
 *     plus a short title of the translator's refusal).
 *   - 'unknown': not decided: not reached yet by the background scan, over the per-function time cap (default 3 s), or
 *     the check itself failed; `reason` says which. The UI lists it, never hides it.
 *
 * Cost control: results are cached in memory per file by content hash (nothing on disk); one preflight at a time per
 * sandbox, held until that preflight settles even past its cap (the cap clock starts when this function's preflight
 * starts, not while it queues behind another); at most `FILE_CONCURRENCY` files classified at once by `classifyFiles`.
 *
 * Where it runs: the work (translate, the compile gate, the sandbox) is CPU-heavy and synchronous in places, so the
 * server does not do it on its main thread. `TriageDeps.backend` is a `TriageBackend`: the worker pool of ./triagePool.ts
 * (the server's), or an in-thread one built from `TriageDeps.sandbox` (tests, and the fallback when workers cannot
 * start). Both run the same functions of this file, so a verdict does not depend on where it was computed.
 *
 * 'unknown' has three causes, told apart by the reason (`unknownCause`): not reached yet ('pending': only the background
 * scan, ./scan.ts, produces it), over a time cap ('slow': decided and cached for that content, a function that loops
 * does not get retried forever; the cap is the per-function one, or the budget of the cheap pass over a file), or the check
 * itself failed ('failed': not cached, retried a bounded number of times).
 *
 * Name-keyed records (`Record<string, ...>` keyed by a function name) are made with `newRecord` and written with `setOwn`,
 * read with `getOwn`: a function may be called `__proto__`, `constructor` or `toString`, and a plain `{}` would drop or
 * inherit those.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { hashText } from '@faithful/core';
import { listExportedFunctions, translate, type RefusalCode } from '@faithful/translate';
import type { LoadResult, Sandbox } from '@faithful/engine';
import { includedNames, testedPreflight } from './testedOriginal.js';

export type FunctionTier = 'provable' | 'tested' | 'none' | 'unknown';

export interface FunctionStatus {
  tier: FunctionTier;
  /** Plain words: why it cannot run ('none'), or why it was not decided ('unknown'). Null otherwise. */
  reason: string | null;
  /** 'tested': the module-level declarations the extracted unit carries besides the function (names). */
  included?: string[];
}

/** The part of `Sandbox` the preflight uses first (tests inject a slow or broken one; a real one is a `Sandbox`). */
export interface SandboxLike {
  load(id: string, source: string, fnName: string, opts: { values: 'js' }): Promise<LoadResult>;
  unload(id: string): Promise<void>;
  /**
   * Stop now, without waiting for queued or running work (`Sandbox.abort`). Called on a sandbox the triage owns (opened by a
   * lazy opener) when a preflight ran past its cap, so the abandoned computation stops using a core.
   */
  abort?(): void;
  /** `abort()` was called (a `Sandbox` says so): a preflight still waiting for its turn on it must use a fresh one. */
  readonly isAborted?: boolean;
}

export type Priority = 'high' | 'low';

/** One function of a file to run the Tested preflight for: its name, and why the translator refused it (null: not found). */
export interface ClassifyItem {
  name: string;
  refusal: RefusalCode | null;
}

/** What the translator says about a name: accepted, or its refusal code (`not-found` included). */
export type Verdict = 'provable' | RefusalCode;

export interface ExportedFn {
  name: string;
  line: number;
  hasJsDoc: boolean;
}

/** The cheap pass over one file's text: its exported functions (one per name, lowest line) and the translator's verdicts. */
export interface QuickInfo {
  fns: ExportedFn[];
  verdicts: Record<string, Verdict>;
}

/**
 * Where triage computations run. The server's is a worker pool (./triagePool.ts); `inlineBackend` runs on the calling
 * thread. Neither throws for a check that fails: that is an 'unknown' status.
 */
export interface TriageBackend {
  /**
   * Exported functions of `text` with the translator's verdict for each (no sandbox). Rejects only if the work could not
   * run at all (`TriageTimeout`: it kept silent for too long).
   */
  quick(text: string, opts?: { priority?: Priority }): Promise<QuickInfo>;
  /** The Tested preflight for each item (sequentially, each with the per-function cap). One status per item. */
  classify(text: string, items: ClassifyItem[], opts?: { priority?: Priority }): Promise<Record<string, FunctionStatus>>;
  close(): Promise<void>;
}

export interface TriageDeps {
  /** A sandbox, or a lazy opener (called on the first load only). Use a sandbox of its own, not a session's. Not needed with a `backend`. */
  sandbox?: SandboxLike | (() => Promise<SandboxLike>);
  /** Where the work runs (the worker pool); in this thread with `sandbox` when absent. */
  backend?: TriageBackend;
  /** Per-function time cap, ms (default 3000). Past it the status is 'unknown'. */
  capMs?: number;
  /** Also run the original on the preflight's sample of generated inputs (default true, as `startTestedOnly` does). */
  sample?: boolean;
  /** Queue priority in a pool: a request the user is waiting for is 'high' (the default); the background scan uses 'low'. */
  priority?: Priority;
  /**
   * Awaited before each chunk of `CLASSIFY_CHUNK` functions of a file is handed to the backend (the background scan waits
   * here while a session job runs, so its pause takes effect within a chunk, not at the next file).
   */
  beforeChunk?: () => Promise<void>;
  /**
   * Called after a preflight ran past its cap and the (lazily opened) sandbox it ran in was aborted: the owner of the
   * opener forgets the sandbox, so the next load opens a fresh one.
   */
  onAbandoned?: () => void;
}

/** Functions of one file handed to the backend at a time (see `TriageDeps.beforeChunk`). */
export const CLASSIFY_CHUNK = 6;

/** The cheap pass over a file was given up on after `ms` (a file with a huge number of functions): every function of it is 'slow'. */
export class TriageTimeout extends Error {
  constructor(readonly ms: number) {
    super(`the check did not finish within ${ms} ms`);
  }
}

// ── name-keyed records ──
/** An empty record that inherits nothing (`__proto__`, `constructor`, `toString` are ordinary names in it). */
export function newRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
/** Define `name` as an own property, whatever the name is (plain assignment of `__proto__` would set the prototype instead). */
export function setOwn<T>(rec: Record<string, T>, name: string, value: T): void {
  Object.defineProperty(rec, name, { value, enumerable: true, writable: true, configurable: true });
}
/** The own value of `name` (never an inherited one: a record that crossed a worker boundary has a normal prototype again). */
export function getOwn<T>(rec: Record<string, T> | undefined, name: string): T | undefined {
  return rec && Object.hasOwn(rec, name) ? rec[name] : undefined;
}
/** Copy the own entries of `from` into `into` (not `Object.assign`: it would assign `__proto__`). */
export function mergeInto<T>(into: Record<string, T>, from: Record<string, T> | undefined): void {
  if (from) for (const k of Object.keys(from)) setOwn(into, k, from[k]!);
}

export const DEFAULT_CAP_MS = 3000;
export const FILE_CONCURRENCY = 4;
/** Files larger than this are not listed by `GET /api/files` either. */
export const MAX_FILE_BYTES = 300_000;

/** Short plain titles of the translator's refusal codes (the same words the Translate screen uses as titles). */
const REFUSAL_WORDS: Record<RefusalCode, string> = {
  float: 'arithmetic that is not provably integer-valued',
  regex: 'regular expressions',
  date: 'dates and clocks',
  'map-set': 'Map or Set',
  dictionary: 'objects used as dictionaries',
  nan: 'NaN or Infinity',
  io: 'input or output',
  random: 'randomness',
  async: 'asynchronous code',
  generic: 'generic type parameters',
  bitwise: 'bitwise operators',
  this: '`this`',
  'mutable-capture': 'captured mutable state',
  'no-termination-measure': 'a loop or recursion with no termination measure the translator can find',
  'unsupported-type': 'a type outside the subset',
  'unsupported-syntax': 'syntax outside the subset',
  'unsupported-library': 'a library call outside the subset',
  'missing-annotation': 'a missing type annotation',
  'non-bmp': 'text outside the Basic Multilingual Plane',
  'not-found': 'the function was not found among the exports',
};

/** Shown for a function the background scan has not reached yet. */
export const UNKNOWN_PENDING = 'Not checked yet: the scan has not reached it.';
const SLOW_PREFIX = 'Checking took longer than ';
const FAILED_PREFIX = 'The check itself failed';
const UNKNOWN_FAILED = `${FAILED_PREFIX}; not run.`;

/** "3 seconds", "1 second", "0.03 seconds". */
function secondsWords(ms: number): string {
  const s = ms / 1000;
  const n = Number.isInteger(s) ? String(s) : String(+s.toFixed(2));
  return `${n} second${s === 1 ? '' : 's'}`;
}

/** The reason of a function whose check ran past the per-function cap: it was started, did not finish, and is not run. */
export function slowReason(capMs: number): string {
  return `${SLOW_PREFIX}${secondsWords(capMs)}; not run.`;
}

export type UnknownCause = 'pending' | 'slow' | 'failed';

/** Why a status is 'unknown' (from its reason); null for a decided status. */
export function unknownCause(s: Pick<FunctionStatus, 'tier' | 'reason'>): UnknownCause | null {
  if (s.tier !== 'unknown') return null;
  if (s.reason?.startsWith(SLOW_PREFIX)) return 'slow';
  if (s.reason?.startsWith(FAILED_PREFIX)) return 'failed';
  return 'pending';
}

export const pendingStatus = (): FunctionStatus => ({ tier: 'unknown', reason: UNKNOWN_PENDING });
export const failedStatus = (): FunctionStatus => ({ tier: 'unknown', reason: UNKNOWN_FAILED });
export const slowStatus = (capMs: number): FunctionStatus => ({ tier: 'unknown', reason: slowReason(capMs) });

/** The longest reason the Pick list carries (characters). */
export const MAX_REASON = 340;
/** The Tested refusal's part of a reason is cut shorter, so the translator's short title after it always fits. */
const PICK_PART_MAX = 220;

/**
 * The one place a reason is made safe for the page: control characters and runs of white space become single spaces; a
 * percent sign (compiler and extractor texts quote source code and error messages, and a `%` on a page that makes claims
 * reads as a percentage) becomes the word "mod"; and the text is cut at a word boundary to `max` (default MAX_REASON)
 * characters, never leaving a half-open code span.
 */
export function tidyReason(text: string, max = MAX_REASON): string {
  let s = text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    // the operator quoted as a name ('%', `%`, '%='), then any other percent sign (a number's, a format string's)
    .replace(/(['`"])%=?\1/g, (_m, q: string) => `${q}mod${q}`)
    .replace(/\s*%=?\s*/g, ' mod ')
    .replace(/ mod ([.,;:)\]])/g, ' mod$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) {
    s = s.slice(0, max - 1);
    const sp = s.lastIndexOf(' ');
    if (sp > max / 2) s = s.slice(0, sp);
    // an odd number of backticks: the cut fell inside a code span; drop that span's start
    if ((s.match(/`/g) ?? []).length % 2 === 1) s = s.slice(0, s.lastIndexOf('`'));
    s = `${s.replace(/[\s,;:(]+$/, '')}…`;
  }
  return s;
}

/**
 * The Pick list's short form of a Tested preflight refusal (the reason `testedBlocker` / `startTestedOnly` give):
 * "fib cannot run on its own: X (line 3, column 1). The Tested tier ..." -> "Cannot run on its own: X (line 3, column 1)."
 * Safe for the page (`tidyReason`).
 */
export function pickReason(fn: string, words: string): string {
  let s = words.split(/\. (?=The Tested tier)/)[0]!.trim();
  if (s.startsWith(`${fn} `)) s = s.slice(fn.length + 1);
  s = s.replace(`inputs cannot be generated from the signature of ${fn}:`, 'inputs cannot be generated from its signature:');
  s = plainCompileReason(s);
  // "... on each of the first 50 inputs generated from its signature (first: fault (...)), so there is nothing to compare a
  // faster version with.": the last clause is the Tested path's advice, and it made the sentence too long for the list
  s = s.replace(/, so there is nothing to compare a faster version with\.?$/, '');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return tidyReason(s.endsWith('.') ? s : `${s}.`, PICK_PART_MAX);
}

/**
 * The compile gate's refusal quotes the compiler: "it and the declarations it uses do not compile by themselves (line 70,
 * column 22: Cannot find name 'Worker')", sometimes with the compiler's own advice ("Do you need to change your target
 * library? Try changing the 'lib' compiler option to ..."), which is about the compiler's settings and not about this
 * function. The Pick list says it in plain words: a name the file neither defines nor gets from a plain function run
 * becomes one sentence; any other diagnostic keeps only its first sentence, without the advice.
 */
function plainCompileReason(s: string): string {
  const m = /^(cannot run on its own: )(?:it and the declarations it uses do not compile by themselves|its file does not compile by itself) \((line \d+, column \d+): ([\s\S]*)\)\.?$/i.exec(s);
  if (!m) return s;
  const diag = m[3]!.trim();
  const name = /^Cannot find name '([^']+)'/.exec(diag)?.[1];
  if (name) return `${m[1]}it uses \`${name}\`, which the file does not define and a plain function run does not provide (${m[2]})`;
  const first = diag.split(/\.\s+(?=[A-Z])/)[0]!.replace(/\.$/, '').trim();
  return `${m[1]}it and the declarations it uses do not compile by themselves (${m[2]}: ${first})`;
}

/** "The translator refuses it too (input or output)." (a name of the category in parentheses reads as a sentence whatever the category is) */
function noneReason(testedWhy: string, refusal: RefusalCode | null): string {
  // a first sentence that had to be cut ends with an ellipsis: nothing is appended after it (a second sentence would run on
  // from a half sentence)
  if (!refusal || testedWhy.endsWith('…')) return tidyReason(testedWhy);
  return tidyReason(`${testedWhy} The translator refuses it too (${REFUSAL_WORDS[refusal] ?? 'outside the subset'}).`);
}

/**
 * One preflight at a time per sandbox; the cap clock starts when this function's preflight starts. The lane is held
 * until the preflight itself SETTLES, not until the cap expires: an abandoned preflight keeps running in the sandbox's
 * own queue, and starting the next function's clock behind it would time out functions that are fast on their own.
 */
const lanes = new WeakMap<object, Promise<unknown>>();
async function capped<T>(key: object, start: () => Promise<T>, capMs: number): Promise<T | 'timeout'> {
  const prev = lanes.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  lanes.set(key, prev.then(() => mine));
  await prev.catch(() => undefined);
  // the timer exists before any synchronous work of the preflight starts
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), capMs);
    timer.unref?.();
  });
  let work: Promise<T>;
  try {
    work = start();
  } catch (e) {
    clearTimeout(timer);
    release();
    throw e;
  }
  void work.then(
    () => release(),
    () => release(),
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const opened = new WeakMap<object, Promise<SandboxLike>>();
function sandboxOf(deps: TriageDeps): Promise<SandboxLike> {
  const s = deps.sandbox;
  if (!s) return Promise.reject(new Error('no sandbox to run the Tested preflight in'));
  if (typeof s !== 'function') return Promise.resolve(s);
  let p = opened.get(s);
  if (!p) {
    p = s();
    p.catch(() => opened.delete(s));
    opened.set(s, p);
  }
  return p;
}

/**
 * The preflight half of a classification: the function the translator refused (`refusal`), is it runnable on the Tested
 * tier? Never throws: a failure of the check itself is 'unknown'.
 */
export async function preflightStatus(fileText: string, fnName: string, refusal: RefusalCode | null, deps: TriageDeps): Promise<FunctionStatus> {
  const cap = deps.capMs ?? DEFAULT_CAP_MS;
  try {
    // The Tested tier's own preflight (testedOriginal.ts, shared with GET /api/tested/check and startTestedOnly): the
    // extracted unit, or the whole file when extraction refuses; signature, compile gate, the real sandbox load, and
    // (unless `sample: false`) the original on a first sample of generated inputs. Capped as a whole.
    const sb = await sandboxOf(deps);
    const sample = deps.sample ?? true;
    // `testedPreflight` yields before its synchronous compile gate, so the cap timer can fire while it runs
    // a preflight queued behind one that was abandoned (and aborted its sandbox) runs on the sandbox opened since
    const pre = await capped(
      sb,
      async () => testedPreflight(fileText, fnName, (sb.isAborted && typeof deps.sandbox === 'function' ? await sandboxOf(deps) : sb) as Sandbox, { sample }),
      cap,
    );
    if (pre === 'timeout') {
      abandon(sb, deps);
      return slowStatus(cap);
    }
    if (!pre.ok) return { tier: 'none', reason: noneReason(pickReason(fnName, pre.reason), refusal) };
    const included = pre.original.scope === 'extracted' ? includedNames(pre.original).filter((n) => n !== fnName) : [];
    return included.length ? { tier: 'tested', reason: null, included } : { tier: 'tested', reason: null };
  } catch {
    return failedStatus();
  }
}

/**
 * The preflight ran past its cap and nobody waits for it any more, but it keeps running in its sandbox (up to 50 inputs of
 * a function that loops, 100 ms each, keep a core busy for 5 s after the pool reports idle). A sandbox the triage opened
 * itself (a lazy opener) is aborted and forgotten, so the next preflight gets a fresh one; a sandbox the caller passed in
 * is the caller's and is left alone.
 */
function abandon(sb: SandboxLike, deps: TriageDeps): void {
  if (typeof deps.sandbox !== 'function') return;
  try {
    sb.abort?.();
  } catch {
    // already gone
  }
  opened.delete(deps.sandbox);
  try {
    deps.onAbandoned?.();
  } catch {
    // the owner's bookkeeping must not turn a slow function into a failed check
  }
}

/** Classify one exported function of `fileText`. Never throws: a failure of the check itself is 'unknown'. */
export async function classifyFunction(fileText: string, fnName: string, deps: TriageDeps): Promise<FunctionStatus> {
  try {
    const tr = translate(fileText, fnName);
    if (tr.ok) return { tier: 'provable', reason: null };
    return preflightStatus(fileText, fnName, tr.refusal.code === 'not-found' ? null : tr.refusal.code, deps);
  } catch {
    return failedStatus();
  }
}

/** The cheap pass: exported functions (one per name, lowest line, JSDoc if any declaration has it) and the translator's verdicts. */
export function quickInfo(fileText: string, onProgress?: () => void): QuickInfo {
  const fns = uniqueFunctions(listExportedFunctions(fileText).filter((f) => f.exported));
  const verdicts = newRecord<Verdict>();
  let n = 0;
  for (const f of fns) {
    try {
      const tr = translate(fileText, f.name);
      setOwn(verdicts, f.name, tr.ok ? 'provable' : tr.refusal.code);
    } catch {
      // a translator crash on this function: the Tested preflight decides it (it is not 'provable')
      setOwn(verdicts, f.name, 'not-found');
    }
    // a worker tells its pool it is still alive (a file with thousands of functions is a long synchronous loop)
    if (onProgress && ++n % QUICK_BEAT === 0) onProgress();
  }
  return { fns, verdicts };
}

/** Functions between two signs of life of the cheap pass. */
export const QUICK_BEAT = 20;

/**
 * One entry per function name: the lowest line, documented when any declaration of the name has a JSDoc (an overloaded
 * function is one function; `listExportedFunctions` reports every declaration).
 */
export function uniqueFunctions<T extends { name: string; line: number; hasJsDoc: boolean }>(fns: T[]): Array<{ name: string; line: number; hasJsDoc: boolean }> {
  const byName = new Map<string, { name: string; line: number; hasJsDoc: boolean }>();
  for (const f of fns) {
    const have = byName.get(f.name);
    if (!have) byName.set(f.name, { name: f.name, line: f.line, hasJsDoc: f.hasJsDoc });
    else {
      have.line = Math.min(have.line, f.line);
      have.hasJsDoc = have.hasJsDoc || f.hasJsDoc;
    }
  }
  return [...byName.values()].sort((a, b) => a.line - b.line);
}

/** The preflight for each item, one after the other (what a worker does for one message). */
export async function classifyItems(
  fileText: string,
  items: ClassifyItem[],
  deps: TriageDeps,
  hooks: { onStart?: (name: string) => void; onResult?: (name: string, status: FunctionStatus) => void } = {},
): Promise<Record<string, FunctionStatus>> {
  const out = newRecord<FunctionStatus>();
  for (const it of items) {
    hooks.onStart?.(it.name);
    const st = await preflightStatus(fileText, it.name, it.refusal, deps);
    setOwn(out, it.name, st);
    hooks.onResult?.(it.name, st);
  }
  return out;
}

/** A backend that runs on the calling thread, in `deps.sandbox` (tests; the fallback when worker threads cannot start). */
export function inlineBackend(deps: TriageDeps): TriageBackend {
  const inner: TriageDeps = { ...deps, backend: undefined };
  return {
    async quick(text) {
      // let timers and I/O run before the synchronous parse and translation
      await new Promise<void>((r) => setImmediate(r));
      return quickInfo(text);
    },
    classify: (text, items) => classifyItems(text, items, inner),
    close: async () => undefined,
  };
}

function backendOf(deps: TriageDeps): TriageBackend {
  if (deps.backend) return deps.backend;
  if (!deps.sandbox) throw new Error('triage needs a sandbox or a backend');
  return inlineBackend(deps);
}

/** Content-hash caches: hash -> the quick pass, hash -> statuses of the file's exported functions. In memory only, bounded. */
const cache = new Map<string, Promise<Record<string, FunctionStatus>>>();
const quickCache = new Map<string, Promise<QuickInfo>>();
const CACHE_MAX = 2000;

export function clearTriageCache(): void {
  cache.clear();
  quickCache.clear();
}

function remember<T>(map: Map<string, Promise<T>>, key: string, p: Promise<T>, keep: (v: T) => boolean): void {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value!);
  map.set(key, p);
  void p.then(
    (v) => {
      if (!keep(v) && map.get(key) === p) map.delete(key);
    },
    () => {
      if (map.get(key) === p) map.delete(key);
    },
  );
}

/** The cheap pass over a file's text (cached by the text's hash). */
export function quickText(fileText: string, deps: TriageDeps, key: string = hashText(fileText)): Promise<QuickInfo> {
  const hit = quickCache.get(key);
  if (hit) return hit;
  const p = backendOf(deps).quick(fileText, { priority: deps.priority });
  if (quickCache.size >= CACHE_MAX) quickCache.delete(quickCache.keys().next().value!);
  quickCache.set(key, p);
  // an answer is kept; so is "gave up": the same content would take as long again. Any other failure is asked again.
  void p.catch((e: unknown) => {
    if (!(e instanceof TriageTimeout) && quickCache.get(key) === p) quickCache.delete(key);
  });
  return p;
}

const PROVABLE: FunctionStatus = { tier: 'provable', reason: null };

/**
 * The exported functions of a file's text, classified (cached by the text's hash). A result whose only undecided
 * functions are over the cap is kept (they would be over it again); one with a failed check is not, so a later request
 * tries again.
 */
export function classifyText(fileText: string, deps: TriageDeps, key: string = hashText(fileText)): Promise<Record<string, FunctionStatus>> {
  const hit = cache.get(key);
  if (hit) return hit;
  const backend = backendOf(deps);
  const p = (async () => {
    const q = await quickText(fileText, deps, key);
    const out = newRecord<FunctionStatus>();
    const items: ClassifyItem[] = [];
    for (const f of q.fns) {
      const v = getOwn(q.verdicts, f.name) ?? 'not-found';
      if (v === 'provable') setOwn(out, f.name, { ...PROVABLE });
      else items.push({ name: f.name, refusal: v === 'not-found' ? null : v });
    }
    // a few functions at a time, so a caller that must pause (the scan, while a session job runs) can
    for (let i = 0; i < items.length; i += CLASSIFY_CHUNK) {
      await deps.beforeChunk?.();
      mergeInto(out, await backend.classify(fileText, items.slice(i, i + CLASSIFY_CHUNK), { priority: deps.priority }));
    }
    return out;
  })();
  remember(cache, key, p, (r) => !Object.values(r).some((s) => unknownCause(s) === 'failed'));
  return p;
}

/** Thrown for a path outside the repository or not a TypeScript file (status 400) or missing (404). */
export class TriageInputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The text of `file` (relative to `repoRoot`; must stay inside it, like `openFunction`), read for triage. Rejects with a
 * `TriageInputError` (status) for a path that is outside the repository (also through a symlink), not a .ts/.mts file,
 * missing, or larger than `GET /api/files` lists.
 */
export async function readRepoFile(repoRoot: string, file: string): Promise<string> {
  const abs = resolve(repoRoot, file);
  const rel = relative(resolve(repoRoot), abs);
  if (!file || rel.startsWith('..') || isAbsolute(rel)) throw new TriageInputError('the file must be inside the repository', 400);
  if (!/\.(ts|mts)$/.test(abs) || /\.d\.ts$/.test(abs)) throw new TriageInputError('only .ts and .mts files are classified', 400);
  let text: string;
  try {
    // containment on the REAL paths: a symlink inside the repository must not reach a file outside it
    const [realRoot, realAbs] = await Promise.all([realpath(resolve(repoRoot)), realpath(abs)]);
    const realRel = relative(realRoot, realAbs);
    if (realRel.startsWith('..') || isAbsolute(realRel)) throw new TriageInputError('the file must be inside the repository', 400);
    const st = await stat(realAbs);
    if (!st.isFile()) throw new Error('not a file');
    if (st.size > MAX_FILE_BYTES) throw new TriageInputError('the file is larger than the function list covers', 400);
    text = await readFile(realAbs, 'utf8');
  } catch (e) {
    if (e instanceof TriageInputError) throw e;
    throw new TriageInputError(`no such file: ${file}`, 404);
  }
  return text;
}

/**
 * A readable file whose check could not be made at all (the cheap pass over it gave up or failed) still has functions:
 * each one says why it is undecided, instead of the whole file being "could not be read".
 */
function undecidedStatuses(fileText: string, why: unknown): Record<string, FunctionStatus> {
  const out = newRecord<FunctionStatus>();
  const st = why instanceof TriageTimeout ? slowStatus(why.ms) : failedStatus();
  for (const f of uniqueFunctions(listExportedFunctions(fileText).filter((x) => x.exported))) setOwn(out, f.name, { ...st });
  return out;
}

async function classifyReadable(fileText: string, deps: TriageDeps): Promise<Record<string, FunctionStatus>> {
  try {
    return await classifyText(fileText, deps);
  } catch (e) {
    return undecidedStatuses(fileText, e);
  }
}

/** The exported functions of `file` (see `readRepoFile` for the path rules), classified. */
export async function classifyFile(repoRoot: string, file: string, deps: TriageDeps): Promise<Record<string, FunctionStatus>> {
  return classifyReadable(await readRepoFile(repoRoot, file), deps);
}

/** Several files, at most `FILE_CONCURRENCY` at once. A file that cannot be read maps to null. */
export async function classifyFiles(repoRoot: string, files: string[], deps: TriageDeps): Promise<Record<string, Record<string, FunctionStatus> | null>> {
  const out: Record<string, Record<string, FunctionStatus> | null> = newRecord();
  const queue = [...new Set(files)];
  const worker = async () => {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
      try {
        setOwn(out, f, await classifyFile(repoRoot, f, deps));
      } catch {
        setOwn(out, f, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FILE_CONCURRENCY, queue.length) }, worker));
  return out;
}

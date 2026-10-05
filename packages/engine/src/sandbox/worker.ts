/**
 * The sandbox worker (Node worker_threads). Spawned by sandbox.ts; never imported by host code.
 *
 * Order at start-up matters: everything the harness needs (parentPort, structuredClone, performance.now, Atomics, the
 * shared index slot) is captured into module-local bindings FIRST, then `hardenRealm()` turns the global-object
 * escapes into traps and removes network/IPC globals, then `installMask()` snapshots the intrinsics. Candidate code is
 * evaluated by `evalMasked` with every ambient global shadowed (mask.ts).
 *
 * NOT a security boundary: a worker thread shares the process with the host. The watchdog (sandbox.ts) and V8
 * resourceLimits bound time and heap; the mask catches accidental impurity. See docs/SECURITY.md notes in the report.
 *
 * Only erasable TypeScript syntax here and in mask.ts: when the engine runs from source (vitest), Node loads these
 * files with its built-in type stripping.
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { Outcome, Val } from '@faithful/translate';
import {
  evalMasked,
  hardenRealm,
  installMask,
  isFaithfulRangeViolation,
  isInvariantViolation,
  takeViolations,
  type PurityViolation,
} from './mask.js';
import type { CallResult, FromWorker, ToWorker } from './protocol.js';

const port = parentPort!;
const postRaw = port.postMessage.bind(port);
const post = (m: FromWorker): void => postRaw(m);
const clone = structuredClone;
const perfNow = performance.now.bind(performance);
const atomicsStore = Atomics.store;
const slot = new Int32Array((workerData as { sab: SharedArrayBuffer }).sab);
const isArray = Array.isArray;
const objectKeys = Object.keys;
const getProto = Object.getPrototypeOf;
const ObjectProto = Object.prototype;
const ErrorProto = Error.prototype;
const RangeErrorCtor = RangeError;
const ErrorCtor = Error;
const isInteger = Number.isInteger;
const isFiniteNum = Number.isFinite;
const objectIs = Object.is;
const MAX = 9007199254740992;
const FLUSH_COUNT = 128;
const FLUSH_MS = 5;

const hardened = hardenRealm(globalThis);
installMask({ watchGlobalKeys: true });

interface Loaded {
  fn: (...args: unknown[]) => unknown;
  instrumented: boolean;
  /** Value domain 'js' (see LoadOptions.values): any finite number; NaN/Infinity/-0/undefined as sentinel objects. */
  js: boolean;
}

// ───────────────────────── 'js' value domain (sentinels; kept in step with differential/jsvalues.ts) ─────────────────────────

const SENTINEL_KEY = '$faithful';

/** NaN, +-Infinity, -0 and undefined as `{ "$faithful": ... }`; null for anything else (no sentinel needed). */
function sentinelOf(v: unknown): Val | null {
  if (v === undefined) return { [SENTINEL_KEY]: 'undefined' };
  if (typeof v !== 'number') return null;
  if (v !== v) return { [SENTINEL_KEY]: 'NaN' };
  if (v === Infinity) return { [SENTINEL_KEY]: 'Infinity' };
  if (v === -Infinity) return { [SENTINEL_KEY]: '-Infinity' };
  if (objectIs(v, -0)) return { [SENTINEL_KEY]: '-0' };
  return null;
}

/** Decode sentinel objects in an argument back to the JavaScript values they stand for. */
function decodeArg(v: unknown, depth: number): unknown {
  if (depth > 10_000 || v === null || typeof v !== 'object') return v;
  if (isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) out[i] = decodeArg(v[i], depth + 1);
    return out;
  }
  const keys = objectKeys(v);
  if (keys.length === 1 && keys[0] === SENTINEL_KEY) {
    switch ((v as Record<string, unknown>)[SENTINEL_KEY]) {
      case 'NaN':
        return NaN;
      case 'Infinity':
        return Infinity;
      case '-Infinity':
        return -Infinity;
      case '-0':
        return -0;
      case 'undefined':
        return undefined;
    }
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = decodeArg((v as Record<string, unknown>)[k], depth + 1);
  return out;
}
const fns = new Map<string, Loaded>();

// ───────────────────────── value conversion ─────────────────────────

class NotVal {
  readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
}

/** Convert a candidate result to a JSON `Val` of the subset, or explain why it is not one. */
function toVal(v: unknown, path: string, depth: number, js = false): Val | NotVal {
  if (depth > 10_000) return new NotVal(`result nests too deeply at ${path}`);
  if (js) {
    const sv = sentinelOf(v);
    if (sv !== null) return sv;
    if (typeof v === 'number' && isFiniteNum(v)) return v;
  }
  if (v === undefined || v === null) return null;
  switch (typeof v) {
    case 'boolean':
    case 'string':
      return v;
    case 'number':
      if (v !== v) return new NotVal(`result is NaN at ${path}`);
      if (!isInteger(v)) return new NotVal(`result is not an integer (${String(v)}) at ${path}`);
      if (v > MAX || v < -MAX) return new NotVal(`result ${String(v)} is outside +-2^53 at ${path}`);
      return v === 0 ? 0 : v; // -0 -> 0: Int has no negative zero, and -0 === 0 in JS
    case 'object': {
      if (isArray(v)) {
        const out: Val[] = [];
        for (let i = 0; i < v.length; i++) {
          const x = toVal(v[i], `${path}[${i}]`, depth + 1, js);
          if (x instanceof NotVal) return x;
          out[i] = x;
        }
        return out;
      }
      const proto = getProto(v);
      if (proto !== ObjectProto && proto !== null) {
        let name = 'object';
        try {
          name = String((proto as { constructor?: { name?: unknown } }).constructor?.name ?? 'object');
        } catch {
          /* hostile prototype */
        }
        return new NotVal(`result is a ${name}, not a plain record, at ${path}`);
      }
      const out: { [k: string]: Val } = {};
      for (const k of objectKeys(v)) {
        const x = toVal((v as Record<string, unknown>)[k], `${path}.${k}`, depth + 1, js);
        if (x instanceof NotVal) return x;
        out[k] = x;
      }
      return out;
    }
    default:
      return new NotVal(`result is a ${typeof v} at ${path}`);
  }
}

/** First path where two Vals differ, or null when they are equal. */
function diffVal(a: unknown, b: unknown, path: string): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return typeof a === 'number' && typeof b === 'number' && a !== a && b !== b ? null : path;
  }
  if (isArray(a) !== isArray(b)) return path;
  if (isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return `${path}.length`;
    for (let i = 0; i < a.length; i++) {
      const d = diffVal(a[i], bb[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  const ka = objectKeys(a);
  const kb = objectKeys(b as object);
  if (ka.length !== kb.length) return path;
  for (const k of ka) {
    const d = diffVal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d !== null) return d;
  }
  return null;
}

// ───────────────────────── one call ─────────────────────────

function str(x: unknown): string {
  try {
    return typeof x === 'string' ? x : String(x);
  } catch {
    return '(unprintable)';
  }
}

function classify(e: unknown, instrumented: boolean): Outcome {
  if (isInvariantViolation(e)) return { tag: 'fault', detail: `impure: ${e.what}` };
  if (typeof e === 'string') return { tag: 'throw', message: e };
  if (typeof e !== 'object' || e === null) return { tag: 'fault', detail: `threw a non-Error value (${typeof e})` };
  try {
    if (instrumented && isFaithfulRangeViolation(e)) return { tag: 'range-violation', detail: str(e.message) };
    const proto = getProto(e);
    const message = (e as { message?: unknown }).message;
    if (proto === ErrorProto && typeof message === 'string') return { tag: 'throw', message };
    if (e instanceof RangeErrorCtor && typeof message === 'string' && /call stack/i.test(message)) {
      return { tag: 'fault', detail: 'stack overflow' };
    }
    if (e instanceof ErrorCtor) return { tag: 'fault', detail: `uncaught ${str(e.name)}: ${str(message)}` };
  } catch {
    /* hostile error object */
  }
  return { tag: 'fault', detail: 'threw a non-Error object' };
}

function runOne(f: Loaded, args: Val[]): CallResult {
  // 'js' domain: sentinel arguments are decoded first; the input-mutation check compares against the decoded values
  const given = f.js ? (decodeArg(args, 0) as unknown[]) : (args as unknown[]);
  const passed = clone(given) as unknown[];
  let outcome: Outcome;
  const t0 = perfNow();
  try {
    const raw = f.fn(...passed);
    const v = toVal(raw, '$', 0, f.js);
    outcome = v instanceof NotVal ? { tag: 'fault', detail: v.reason } : { tag: 'ok', value: v };
  } catch (e) {
    outcome = classify(e, f.instrumented);
  }
  const ms = perfNow() - t0;
  const violations: PurityViolation[] = takeViolations();
  for (let i = 0; i < given.length; i++) {
    const d = diffVal(given[i], passed[i], '$');
    if (d !== null) violations[violations.length] = { kind: 'input-mutation', what: `argument ${i} at ${d}` };
  }
  if (outcome.tag !== 'fault' || !outcome.detail.startsWith('impure:')) {
    const bad = violations.find((v) => v.kind === 'ambient' || v.kind === 'intrinsic' || v.kind === 'global-write');
    if (bad) outcome = { tag: 'fault', detail: `impure: ${bad.what}` };
  }
  return { outcome, violations, ms };
}

// ───────────────────────── messages ─────────────────────────

function handle(m: ToWorker): void {
  switch (m.type) {
    case 'load': {
      try {
        const fn = evalMasked<(...a: unknown[]) => unknown>(m.js, m.fnName, { instrumented: m.instrumented });
        const violations = takeViolations();
        if (violations.length > 0) {
          post({ type: 'loaded', seq: m.seq, ok: false, error: `impure at load: ${violations[0]!.what}`, violations });
          return;
        }
        fns.set(m.id, { fn, instrumented: m.instrumented, js: m.values === 'js' });
        post({ type: 'loaded', seq: m.seq, ok: true });
      } catch (e) {
        const violations = takeViolations();
        const err = e instanceof ErrorCtor ? `${str(e.name)}: ${str(e.message)}` : str(e);
        post({ type: 'loaded', seq: m.seq, ok: false, error: err, violations });
      }
      return;
    }
    case 'unload':
      fns.delete(m.id);
      post({ type: 'unloaded', seq: m.seq });
      return;
    case 'call': {
      const f = fns.get(m.id);
      if (!f) return post({ type: 'error', seq: m.seq, message: `no function loaded as ${m.id}` });
      atomicsStore(slot, 0, 0);
      post({ type: 'result', seq: m.seq, result: runOne(f, m.args) });
      return;
    }
    case 'batch': {
      const f = fns.get(m.id);
      if (!f) return post({ type: 'error', seq: m.seq, message: `no function loaded as ${m.id}` });
      let buf: Array<[number, CallResult]> = [];
      let last = perfNow();
      for (const [idx, args] of m.items) {
        atomicsStore(slot, 0, idx);
        buf[buf.length] = [idx, runOne(f, args)];
        const t = perfNow();
        if (buf.length >= FLUSH_COUNT || t - last >= FLUSH_MS) {
          post({ type: 'chunk', seq: m.seq, items: buf });
          buf = [];
          last = t;
        }
      }
      atomicsStore(slot, 0, -1);
      if (buf.length > 0) post({ type: 'chunk', seq: m.seq, items: buf });
      post({ type: 'batch-done', seq: m.seq });
      return;
    }
  }
}

port.on('message', (m: ToWorker) => {
  try {
    handle(m);
  } catch (e) {
    post({ type: 'error', seq: (m as { seq?: number }).seq ?? -1, message: str(e) });
  }
});
post({ type: 'ready', hardened });

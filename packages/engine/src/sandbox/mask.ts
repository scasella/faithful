/**
 * Adapted from scasella/undefined packages/engine/src/sandbox/mask.ts, MIT, (c) 2026 Stephen Casella; changes: retargeted from browser
 * Web Workers to Node worker_threads (trapped names are Node's ambient globals: process, require, module, Buffer,
 * console, timers, performance, crypto, fetch, WebAssembly, SharedArrayBuffer/Atomics, Intl, WeakRef/FinalizationRegistry);
 * violations are structured records `{ kind, what }` instead of strings; the intrinsic snapshot is taken explicitly by
 * `installMask()` (after `hardenRealm()`), not at module load, so importing this module never changes the importing
 * realm; added `hardenRealm()` (Function/AsyncFunction/GeneratorFunction constructors and indirect `eval` become traps,
 * network/IPC globals are removed, global key set is watched); instrumented mode injects `__faithfulCheck`,
 * `__faithfulInt` and `FaithfulRangeViolation`; removed the test-code shadowing, DOM scrub and message locking.
 *
 * Purity masking for candidate code running inside the sandbox worker (sandbox/worker.ts).
 *
 * Candidate JS is evaluated with `new Function(<masked names>, '"use strict"; ...')`, so every ambient global that could
 * do I/O, read the clock, schedule work, or reach the real global object is shadowed by a trap. Touching a trap records
 * a violation and throws `InvariantViolation`. The record survives `try { Math.random() } catch {}`.
 *
 * Intrinsic integrity: candidates run in the same realm as the harness, so `Object.is = () => true` or a replaced
 * `Array.prototype.push` would corrupt every later call. `installMask()` snapshots key intrinsics (own property
 * descriptors and key sets); `takeViolations()` verifies, records "modified Object.is" / "added property foo to
 * Array.prototype", and RESTORES the originals.
 *
 * Honest limit: this is accident-catching, not a security boundary. A determined adversary in the same V8 isolate can
 * find ways around shadowing (e.g. Error.prepareStackTrace tricks, prototype pollution between the check and the use).
 * The worker running this has a watchdog and memory limits, but a worker thread shares the process with the host.
 */

// Captured before any candidate can run: the integrity sweep must not call anything a candidate could replace.
const gOPD = Object.getOwnPropertyDescriptor;
const defineProp = Object.defineProperty;
const ownKeys = Reflect.ownKeys;
const deleteProp = Reflect.deleteProperty;
const objectIs = Object.is;
const getProto = Object.getPrototypeOf;
const isSafeInteger = Number.isSafeInteger;

export type ViolationKind =
  /** An ambient global (clock, randomness, I/O, timers, the global object, code-from-strings) was touched. */
  | 'ambient'
  /** A shared intrinsic (Object.is, Array.prototype.push, the masked Math ...) was modified or extended; restored. */
  | 'intrinsic'
  /** A property was added to the real global object (only reachable through an escape). Deleted again. */
  | 'global-write'
  /** The function mutated one of its (cloned) arguments. Reported, does not change the outcome. */
  | 'input-mutation'
  /** Two calls on the same input produced different outcomes. */
  | 'nondeterminism';

export interface PurityViolation {
  kind: ViolationKind;
  /** e.g. `Math.random`, `Date.now`, `modified Object.is`, `argument 0 at $[2]`. */
  what: string;
}

export class InvariantViolation extends Error {
  readonly isInvariantViolation = true;
  readonly what: string;
  constructor(what: string) {
    super(`candidate used ${what}`);
    this.what = what;
    this.name = 'InvariantViolation';
  }
}

export function isInvariantViolation(e: unknown): e is InvariantViolation {
  return typeof e === 'object' && e !== null && (e as { isInvariantViolation?: unknown }).isInvariantViolation === true;
}

/** Thrown by the injected `__faithfulCheck` / `__faithfulInt` helpers in instrumented mode. */
export class FaithfulRangeViolation extends Error {
  readonly isFaithfulRangeViolation = true;
  constructor(detail: string) {
    super(detail);
    this.name = 'FaithfulRangeViolation';
  }
}

/**
 * Recognises a range violation thrown by the injected helper, or by a helper class of the same name that the
 * instrumented source defines itself (matched by `name`, so a source-local `class FaithfulRangeViolation extends Error`
 * works too).
 */
export function isFaithfulRangeViolation(e: unknown): e is Error {
  if (typeof e !== 'object' || e === null) return false;
  if ((e as { isFaithfulRangeViolation?: unknown }).isFaithfulRangeViolation === true) return true;
  return (e as { name?: unknown }).name === 'FaithfulRangeViolation';
}

const recorded: PurityViolation[] = [];

/** Append without Array.prototype.push (a candidate may have replaced it). */
function append(kind: ViolationKind, what: string): void {
  defineProp(recorded, recorded.length, { value: { kind, what }, writable: true, enumerable: true, configurable: true });
}

/**
 * Violations recorded since the last take. Also verifies (and restores) the intrinsic table and the global key set,
 * so call it after every candidate call.
 */
export function takeViolations(): PurityViolation[] {
  verifyIntrinsics();
  const out: PurityViolation[] = [];
  for (let i = 0; i < recorded.length; i++) defineProp(out, i, { value: recorded[i], writable: true, enumerable: true, configurable: true });
  recorded.length = 0;
  return out;
}

function fire(what: string): never {
  append('ambient', what);
  throw new InvariantViolation(what);
}

function trap(what: string): unknown {
  const fail = (): never => fire(what);
  return new Proxy(function () {}, {
    get: fail,
    set: fail,
    has: fail,
    apply: fail,
    construct: fail,
    deleteProperty: fail,
    defineProperty: fail,
    getOwnPropertyDescriptor: fail,
    ownKeys: fail,
    getPrototypeOf: fail,
    setPrototypeOf: fail,
  });
}

/** Ambient Node globals shadowed by traps. `eval` cannot be shadowed (not a legal strict parameter name): see hardenRealm. */
export const TRAPPED = [
  // the real global object
  'globalThis', 'global', 'self', 'window',
  // Node module system and process
  'process', 'require', 'module', 'exports', '__filename', '__dirname', 'Buffer',
  // I/O
  'console', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'BroadcastChannel', 'MessageChannel', 'MessagePort',
  'Worker', 'postMessage', 'close', 'navigator', 'Request', 'Response', 'Headers', 'FormData',
  // clock, randomness, scheduling, GC-observable nondeterminism
  'performance', 'crypto', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask', 'WeakRef', 'FinalizationRegistry', 'Intl',
  // shared memory and other code
  'SharedArrayBuffer', 'Atomics', 'WebAssembly',
  // code from strings
  'Function',
] as const;

interface Masked {
  names: string[];
  values: unknown[];
  /** Shared across every evalMasked in this realm, so part of the integrity table. */
  shared: Array<[string, object]>;
}

let cached: Masked | null = null;

function build(): Masked {
  if (cached) return cached;
  const RealDate = Date;
  class MaskedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) fire('Date (reads the clock)');
      super(...(args as [number]));
    }
    static override now(): number {
      return fire('Date.now');
    }
    static override [Symbol.hasInstance](v: unknown): boolean {
      return v instanceof RealDate;
    }
  }
  // `Date()` without `new` returns the current time as a string: a clock read.
  const maskedDateCtor = new Proxy(MaskedDate, { apply: () => fire('Date (reads the clock)') });
  const maskedMath = Object.create(Object.getPrototypeOf(Math), Object.getOwnPropertyDescriptors(Math)) as Math;
  Object.defineProperty(maskedMath, 'random', {
    value: () => fire('Math.random'),
    writable: true,
    configurable: true,
    enumerable: false,
  });
  const names: string[] = [...TRAPPED, 'Date', 'Math'];
  const values: unknown[] = [...TRAPPED.map((n) => trap(n)), maskedDateCtor, maskedMath];
  cached = {
    names,
    values,
    shared: [
      ['Date', MaskedDate],
      ['Date.prototype', MaskedDate.prototype],
      ['Math', maskedMath],
    ],
  };
  return cached;
}

/** Names injected in instrumented mode (see `evalMasked`). */
export const INSTRUMENT_NAMES = ['__faithfulCheck', '__faithfulInt', 'FaithfulRangeViolation'] as const;

/**
 * `__faithfulCheck(ok, detail)`: throws FaithfulRangeViolation(detail) unless `ok === true`.
 * `__faithfulInt(value, detail)`: returns `value` when it is an integer with |value| <= 2^53, else throws.
 * (2^53 itself is allowed: DESIGN.md bounds intermediates by [-2^53, 2^53]; Number.isSafeInteger stops at 2^53 - 1.)
 */
function instrumentValues(): unknown[] {
  const MAX = 9007199254740992;
  const check = (ok: unknown, detail: unknown): void => {
    if (ok !== true) throw new FaithfulRangeViolation(typeof detail === 'string' ? detail : 'range check failed');
  };
  const int = (value: unknown, detail: unknown): unknown => {
    if (typeof value === 'number' && (isSafeInteger(value) || value === MAX || value === -MAX)) return value;
    throw new FaithfulRangeViolation(
      (typeof detail === 'string' ? detail : 'value') + ' is not an integer within +-2^53 (got ' + String(value) + ')',
    );
  };
  return [check, int, FaithfulRangeViolation];
}

// ───────────────────────── realm hardening ─────────────────────────

/**
 * Call once, in the sandbox worker only, before `installMask()`. Makes the well-known escapes to the real global
 * object trap instead:
 *  - `(() => 0).constructor('return this')()`, and the same through async / generator / async-generator functions:
 *    each `<Kind>Function.prototype.constructor` becomes a trap;
 *  - indirect eval `(0, eval)('this')` (and direct `eval`, which resolves to the global binding): `globalThis.eval`
 *    becomes a trap.
 * Then removes network / IPC globals from the real global object, so code that escapes anyway still finds no fetch.
 * Never call this in a host process: it breaks `fn.constructor` for everything in the realm.
 */
export function hardenRealm(scope: object = globalThis): string[] {
  const changed: string[] = [];
  const protos: Array<[string, object]> = [
    ['Function', Function.prototype],
    ['AsyncFunction', getProto(async function () {}) as object],
    ['GeneratorFunction', getProto(function* () {}) as object],
    ['AsyncGeneratorFunction', getProto(async function* () {}) as object],
  ];
  for (const [label, proto] of protos) {
    try {
      defineProp(proto, 'constructor', { value: trap(`${label} constructor`), writable: false, configurable: false, enumerable: false });
      changed.push(`${label}.prototype.constructor`);
    } catch {
      /* already locked */
    }
  }
  try {
    defineProp(scope, 'eval', { value: trap('eval'), writable: false, configurable: false, enumerable: false });
    changed.push('eval');
  } catch {
    /* non-configurable */
  }
  const scrub = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'BroadcastChannel', 'MessageChannel', 'MessagePort',
    'Request', 'Response', 'Headers', 'FormData', 'navigator', 'WebAssembly', 'SharedArrayBuffer', 'Atomics',
  ];
  for (const n of scrub) {
    try {
      if (!(n in scope)) continue;
      defineProp(scope, n, { value: undefined, writable: false, configurable: false, enumerable: false });
      changed.push(n);
    } catch {
      /* non-configurable in this engine: the shadowing still applies */
    }
  }
  return changed;
}

// ───────────────────────── intrinsic integrity ─────────────────────────

interface Watched {
  label: string;
  obj: object;
  keys: PropertyKey[];
  descs: PropertyDescriptor[];
  /** Also detect added own properties. */
  countKeys: boolean;
  /** For globalThis: added keys are a 'global-write' and are deleted, existing ones are not compared. */
  global: boolean;
}

const watched: Watched[] = [];

function watch(label: string, obj: unknown, only?: readonly string[], global = false): void {
  if ((typeof obj !== 'object' && typeof obj !== 'function') || obj === null) return;
  const keys: PropertyKey[] = [];
  const descs: PropertyDescriptor[] = [];
  for (const k of only ?? ownKeys(obj)) {
    const d = gOPD(obj, k);
    if (!d) continue;
    keys.push(k);
    descs.push(d);
  }
  watched.push({ label, obj, keys, descs, countKeys: only === undefined, global });
}

function sameDescriptor(a: PropertyDescriptor | undefined, b: PropertyDescriptor): boolean {
  return (
    a !== undefined &&
    objectIs(a.value, b.value) &&
    a.get === b.get &&
    a.set === b.set &&
    a.writable === b.writable &&
    a.enumerable === b.enumerable &&
    a.configurable === b.configurable
  );
}

function keyText(label: string, k: PropertyKey): string {
  if (typeof k !== 'symbol') return label + '.' + String(k);
  let desc = '';
  try {
    desc = String(k.description);
  } catch {
    /* Symbol.prototype tampered with */
  }
  return label + '[' + desc + ']';
}

let installed = false;

/**
 * Snapshot the intrinsic table. Call once in the sandbox worker after `hardenRealm()`. Idempotent. Before this call
 * `takeViolations()` only reports trap hits (useful in host-side unit tests of the traps).
 */
export function installMask(opts: { watchGlobalKeys?: boolean } = {}): void {
  if (installed) return;
  installed = true;
  const proto = (f: unknown): unknown => (f as { prototype?: unknown }).prototype;
  const ctors: Array<[string, unknown]> = [
    ['Object', Object], ['Array', Array], ['String', String], ['Number', Number], ['Boolean', Boolean],
    ['BigInt', BigInt], ['Symbol', Symbol], ['Map', Map], ['Set', Set], ['Date', Date], ['RegExp', RegExp],
    ['Promise', Promise], ['Function', Function], ['Error', Error], ['TypeError', TypeError], ['RangeError', RangeError],
  ];
  for (const [name, c] of ctors) {
    watch(name, c);
    watch(`${name}.prototype`, proto(c));
  }
  watch('JSON', JSON);
  watch('Reflect', Reflect);
  watch('Math', Math);
  const arrayIterator = Object.getPrototypeOf([][Symbol.iterator]()) as object;
  watch('ArrayIterator.prototype', arrayIterator);
  watch('Iterator.prototype', Object.getPrototypeOf(arrayIterator));
  for (const [label, obj] of build().shared) watch(label, obj);
  const globals = [...ctors.map(([n]) => n), 'JSON', 'Reflect', 'Math', 'structuredClone'];
  watch('globalThis', globalThis, globals.filter((n) => gOPD(globalThis, n) !== undefined));
  if (opts.watchGlobalKeys) {
    const keys = ownKeys(globalThis);
    const descs: PropertyDescriptor[] = [];
    for (const k of keys) descs.push(gOPD(globalThis, k)!);
    watched.push({ label: 'globalThis', obj: globalThis, keys, descs, countKeys: true, global: true });
  }
}

/** Compare every watched intrinsic with its snapshot; record and restore any difference. Calls nothing replaceable. */
function verifyIntrinsics(): void {
  for (let w = 0; w < watched.length; w++) {
    const { label, obj, keys, descs, countKeys, global } = watched[w]!;
    if (!global) {
      for (let i = 0; i < keys.length; i++) {
        const orig = descs[i]!;
        if (sameDescriptor(gOPD(obj, keys[i]!), orig)) continue;
        append('intrinsic', 'modified ' + keyText(label, keys[i]!));
        try {
          defineProp(obj, keys[i]!, orig);
        } catch {
          /* frozen / non-configurable now: recorded, cannot be undone */
        }
      }
    }
    if (!countKeys) continue;
    const now = ownKeys(obj);
    if (now.length === keys.length) continue;
    for (let j = 0; j < now.length; j++) {
      let known = false;
      for (let i = 0; i < keys.length && !known; i++) known = objectIs(keys[i], now[j]);
      if (known) continue;
      const k = now[j]!;
      const name = typeof k === 'symbol' ? keyText('', k).slice(1) : String(k);
      if (global) append('global-write', 'added global ' + name);
      else append('intrinsic', 'added property ' + name + ' to ' + label);
      deleteProp(obj, k);
    }
  }
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Evaluate strict-mode `js` (which must declare a function called `exportName`) with all masked names shadowed, and
 * return that function. Recursion works because the declaration name is in scope inside the function. With
 * `instrumented`, `__faithfulCheck`, `__faithfulInt` and `FaithfulRangeViolation` are in scope as well.
 */
export function evalMasked<T = (...args: never[]) => unknown>(js: string, exportName: string, opts: { instrumented?: boolean } = {}): T {
  if (!IDENT.test(exportName)) throw new Error(`invalid function name: ${exportName}`);
  const { names, values } = build();
  const allNames = opts.instrumented ? [...names, ...INSTRUMENT_NAMES] : names;
  const allValues = opts.instrumented ? [...values, ...instrumentValues()] : values;
  // The real constructor, captured at module load: hardenRealm() replaces Function.prototype.constructor, not Function.
  const factory = new RealFunction(
    ...allNames,
    // The inner block lets the source declare its own `class FaithfulRangeViolation` etc. without clashing with the
    // parameter of the same name (a lexical declaration may not redeclare a parameter at function-body level).
    `"use strict";\n{\n${js}\n;return typeof ${exportName} === "function" ? ${exportName} : undefined;\n}`,
  ) as (...a: unknown[]) => T | undefined;
  const fn = factory(...allValues);
  if (fn === undefined) throw new Error(`function ${exportName} is not defined by the loaded source`);
  return fn;
}

const RealFunction = Function;

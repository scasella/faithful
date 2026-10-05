/**
 * JavaScript values outside the integer model, as plain JSON (the Tested-only path for functions the translator refused).
 *
 * Everything Faithful stores or streams (events.jsonl, session.json, the SSE stream, provenance.json) is `JSON.stringify`d,
 * which turns NaN and +-Infinity into `null`, -0 into `0` and drops `undefined`. So these five values cross every
 * boundary (sandbox, persistence, UI) as single-key sentinel objects:
 *
 *   NaN -> { "$faithful": "NaN" }        Infinity -> { "$faithful": "Infinity" }   -Infinity -> { "$faithful": "-Infinity" }
 *   -0  -> { "$faithful": "-0" }         undefined -> { "$faithful": "undefined" }
 *
 * Every other finite number (integers of any size, non-integer doubles) is itself. The sandbox's `'js'` value domain
 * (`LoadOptions.values`) decodes sentinel arguments before a call and encodes results after it (sandbox/worker.ts keeps
 * its own copy of this mapping; the two are tested against each other). A record type with a field named `$faithful`
 * would be ambiguous, so the signature generator refuses it.
 *
 * Equality policy for comparing outcomes (`jsValEqual`, `jsOutcomeEqual`), decided once and recorded with every
 * Tested-only result:
 *   - NaN equals NaN (a function returning NaN where the original returns NaN agrees with it);
 *   - -0 and 0 are DIFFERENT (`Object.is` semantics). They are observable (`1 / x`, `Object.is`, `Math.sign`), and the
 *     check never accepts a difference it cannot rule out. When two outcomes differ ONLY in the sign of a zero, the
 *     rejection says so in those words (`differsOnlyInZeroSign`), so the user can judge it;
 *   - `undefined` and `null` are different;
 *   - records compare by key set and value, key order ignored; a key whose value is `undefined` is not the same as a
 *     missing key.
 */
import type { Outcome, Val } from '@faithful/translate';

export const SENTINEL_KEY = '$faithful';
export type SpecialName = 'NaN' | 'Infinity' | '-Infinity' | '-0' | 'undefined';
export const SPECIAL_NAMES: readonly SpecialName[] = ['NaN', 'Infinity', '-Infinity', '-0', 'undefined'];

/** The sentinel for a special value. */
export function special(name: SpecialName): Val {
  return { [SENTINEL_KEY]: name };
}

/** The special a value stands for, or null when it is not a sentinel. */
export function sentinelName(v: unknown): SpecialName | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1 || keys[0] !== SENTINEL_KEY) return null;
  const n = (v as Record<string, unknown>)[SENTINEL_KEY];
  return typeof n === 'string' && (SPECIAL_NAMES as readonly string[]).includes(n) ? (n as SpecialName) : null;
}

/** A raw JavaScript value (numbers, strings, booleans, null, undefined, arrays, plain objects) as a JSON `Val`. */
export function encodeJs(v: unknown): Val {
  if (v === undefined) return special('undefined');
  if (v === null) return null;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return special('NaN');
    if (v === Infinity) return special('Infinity');
    if (v === -Infinity) return special('-Infinity');
    if (Object.is(v, -0)) return special('-0');
    return v;
  }
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(encodeJs);
  if (typeof v === 'object') {
    const o: { [k: string]: Val } = {};
    for (const k of Object.keys(v)) o[k] = encodeJs((v as Record<string, unknown>)[k]);
    return o;
  }
  throw new TypeError(`encodeJs: a ${typeof v} is not a JSON value`);
}

/** A JSON `Val` with sentinels back to the raw JavaScript value. */
export function decodeJs(v: Val): unknown {
  const s = sentinelName(v);
  if (s !== null) {
    switch (s) {
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
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decodeJs);
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(v)) o[k] = decodeJs((v as { [k: string]: Val })[k]!);
  return o;
}

/** Does this value (encoded) contain a special (NaN, +-Infinity, -0; `undefined` is not counted)? */
export function containsSpecialNumber(v: Val): boolean {
  const s = sentinelName(v);
  if (s !== null) return s !== 'undefined';
  if (v === null || typeof v !== 'object') return false;
  return Array.isArray(v) ? v.some(containsSpecialNumber) : Object.values(v).some(containsSpecialNumber);
}

/** Does this value contain a finite number that is not an integer? */
export function containsNonInteger(v: Val): boolean {
  if (typeof v === 'number') return !Number.isInteger(v);
  if (v === null || typeof v !== 'object' || sentinelName(v) !== null) return false;
  return Array.isArray(v) ? v.some(containsNonInteger) : Object.values(v).some(containsNonInteger);
}

/** Structural equality on encoded values under the policy in the module comment. Raw numbers compare with `Object.is`. */
export function jsValEqual(a: Val, b: Val): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as Val[];
    return a.length === bb.length && a.every((x, i) => jsValEqual(x, bb[i]!));
  }
  const ao = a as { [k: string]: Val };
  const bo = b as { [k: string]: Val };
  const ka = Object.keys(ao);
  const kb = Object.keys(bo);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsValEqual(ao[k]!, bo[k]!));
}

/** Outcome equality for the Tested-only path: same tag; same value (`jsValEqual`) or same thrown message. A fault never agrees. */
export function jsOutcomeEqual(a: Outcome, b: Outcome): boolean {
  if (a.tag === 'fault' || b.tag === 'fault') return false;
  if (a.tag !== b.tag) return false;
  if (a.tag === 'ok') return jsValEqual(a.value, (b as { value: Val }).value);
  if (a.tag === 'throw') return a.message === (b as { message: string }).message;
  return a.detail === (b as { detail: string }).detail;
}

/** -0 read as 0 everywhere (for `differsOnlyInZeroSign`). */
function zeroless(v: Val): Val {
  if (sentinelName(v) === '-0') return 0;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(zeroless);
  const o: { [k: string]: Val } = {};
  for (const k of Object.keys(v)) o[k] = zeroless(v[k]!);
  return o;
}

/** True when two `ok` outcomes differ, but would be equal if -0 were read as 0. */
export function differsOnlyInZeroSign(a: Outcome, b: Outcome): boolean {
  if (a.tag !== 'ok' || b.tag !== 'ok') return false;
  return !jsValEqual(a.value, b.value) && jsValEqual(zeroless(a.value), zeroless(b.value));
}

/** A value in JavaScript notation, for people and prompts: `[0.5, NaN, -0, undefined]`, `{ a: "x" }`. */
export function showJs(v: Val): string {
  const s = sentinelName(v);
  if (s !== null) return s;
  if (v === null) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(showJs).join(', ')}]`;
  const keys = Object.keys(v);
  return keys.length ? `{ ${keys.map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${showJs(v[k]!)}`).join(', ')} }` : '{}';
}

/** An argument list in JavaScript notation: `(xs = [1, 2.5])` style without names: `[1, 2.5], "a"`. */
export function showJsArgs(args: Val[]): string {
  return args.map(showJs).join(', ');
}

/** An outcome in plain words: `returns 1.5`, `throws "empty"`. */
export function showJsOutcome(o: Outcome): string {
  if (o.tag === 'ok') return `returns ${showJs(o.value)}`;
  if (o.tag === 'throw') return `throws ${JSON.stringify(o.message)}`;
  return `${o.tag} (${o.detail})`;
}

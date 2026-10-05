/**
 * The seam between the translator's `instrumentedTs` and the sandbox's instrumented mode.
 *
 * The translator's runtime (`FAITHFUL_TS_RUNTIME`, translate/src/instrument.ts) signals a failed range check by throwing
 * a plain `RangeViolation` object and the function's own literal `throw` by throwing a plain `UserThrow` object. The
 * sandbox worker classifies a thrown non-Error object as a `fault`, and recognises a range violation only as an error
 * named `FaithfulRangeViolation` (the class it injects in instrumented mode). This module rewrites exactly those two
 * spots of the runtime text:
 *   - `class RangeViolation { ... }`  ->  `class RangeViolation extends FaithfulRangeViolation { ... }`
 *     (outcome `range-violation`, detail = the runtime's detail string, e.g. `range check failed at line 3: a * b`);
 *   - `userThrow(message) { return new UserThrow(message); }`  ->  `... return new Error(message); ...`
 *     (a plain `Error` with a string message: outcome `throw`).
 * Every check helper (add/sub/mul/mod/floorDiv/ceilDiv/at/charCodeAt/lower/upper) is used verbatim, so the semantics
 * are the translator's own. If the runtime text changes so that a rewrite no longer matches, this module throws at
 * call time instead of silently classifying range violations as faults.
 */
import { FAITHFUL_TS_RUNTIME, type Translation } from '@faithful/translate';

const RANGE_FROM = 'class RangeViolation { constructor(detail) { this.detail = detail; } }';
const RANGE_TO = 'class RangeViolation extends FaithfulRangeViolation { constructor(detail) { super(detail); this.detail = detail; } }';
const THROW_FROM = 'userThrow(message) { return new UserThrow(message); }';
const THROW_TO = 'userThrow(message) { return new Error(message); }';

function rewriteOnce(text: string, from: string, to: string): string {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) {
    throw new Error(`differential: FAITHFUL_TS_RUNTIME changed; expected exactly one occurrence of: ${from}`);
  }
  return text.slice(0, i) + to + text.slice(i + from.length);
}

/** The translator runtime adapted to the sandbox's instrumented mode (load with `{ instrumented: true }`). */
export function sandboxRuntime(): string {
  return rewriteOnce(rewriteOnce(FAITHFUL_TS_RUNTIME, RANGE_FROM, RANGE_TO), THROW_FROM, THROW_TO);
}

/**
 * The name under which the instrumented sandbox source exposes the translated function: load it with
 * `Sandbox.load(id, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true })`.
 */
export const INSTRUMENTED_ENTRY = '__faithful_entry';

/**
 * Source for the range-instrumented original; load it under `INSTRUMENTED_ENTRY` (not `t.fnName`).
 *
 * Hygiene (red-team round 3, r3FnNameRangeClass): the runtime sits in the outer block, the translated function and
 * the module constants it reads in a nested function scope of their own. The runtime's free identifiers
 * (`FaithfulRangeViolation`, `Math`, `BigInt`, `String`, `Error`) therefore resolve to the sandbox's injected bindings
 * and never to a user declaration of the same name (before, a function named `FaithfulRangeViolation` became the base
 * class of every range violation, which turned them into faults). The user's own code still sees exactly the masked
 * scope it would see when loaded alone.
 */
export function instrumentedSandboxSource(t: Pick<Translation, 'instrumentedTs' | 'fnName'>): string {
  return `${sandboxRuntime()}\nconst ${INSTRUMENTED_ENTRY} = (() => {\n${t.instrumentedTs}\nreturn ${t.fnName};\n})();\n`;
}

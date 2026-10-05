/**
 * Messages between the Sandbox (main thread) and its worker (sandbox/worker.ts). Types only.
 * Everything crossing the boundary is structured-clone data: JSON `Val` arguments, `CallResult`s, strings.
 */
import type { Outcome, Val } from '@faithful/translate';
import type { PurityViolation } from './mask.js';

export interface CallResult {
  /**
   * `fault` when the call timed out, overflowed the stack, ran out of memory, threw something that is not a literal
   * `Error`/string, returned something that is not a JSON `Val` of the subset, or touched an ambient global /
   * intrinsic (an `ambient`, `intrinsic` or `global-write` violation). An `input-mutation` violation is reported in
   * `violations` but does not change the outcome.
   */
  outcome: Outcome;
  violations: PurityViolation[];
  /** Wall-clock time of the call inside the worker (0 when it never returned). */
  ms: number;
}

export type ToWorker =
  | { type: 'load'; seq: number; id: string; js: string; fnName: string; instrumented: boolean; values?: 'subset' | 'js' }
  | { type: 'unload'; seq: number; id: string }
  | { type: 'call'; seq: number; id: string; args: Val[] }
  /** `items` are `[absolute index, args]`; the worker stores the index of the call in progress in the shared slot. */
  | { type: 'batch'; seq: number; id: string; items: Array<[number, Val[]]> };

export type FromWorker =
  | { type: 'ready'; hardened: string[] }
  | { type: 'loaded'; seq: number; ok: true }
  | { type: 'loaded'; seq: number; ok: false; error: string; violations: PurityViolation[] }
  | { type: 'unloaded'; seq: number }
  | { type: 'result'; seq: number; result: CallResult }
  | { type: 'chunk'; seq: number; items: Array<[number, CallResult]> }
  | { type: 'batch-done'; seq: number }
  | { type: 'error'; seq: number; message: string };

/** Slot 0 of the shared Int32Array: absolute index of the batch call in progress (-1 = none). */
export const SLOT_INDEX = 0;

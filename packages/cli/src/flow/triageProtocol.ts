/**
 * Messages between the triage worker pool (./triagePool.ts) and a triage worker (./triageWorker.ts). Types only.
 *
 * One request is in flight per worker. A `classify` request streams: `start` before each function's preflight and
 * `result` after it, so when a worker has to be killed (it stopped answering, or died) the functions it had decided are
 * kept and only the one in progress is lost.
 */
import type { FunctionStatus, QuickInfo, ClassifyItem } from './triage.js';

export type ToWorker =
  | { id: number; op: 'quick'; text: string }
  | { id: number; op: 'classify'; text: string; items: ClassifyItem[]; capMs: number; sample: boolean }
  /** Test hook: block the worker's thread for `ms` (a synchronous stall, like a huge compile gate). */
  | { id: number; op: 'spin'; ms: number };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'start'; id: number; name: string }
  /** A `quick` request is still working (every `QUICK_BEAT` functions): the pool's silence watchdog starts over. */
  | { type: 'beat'; id: number }
  | { type: 'result'; id: number; name: string; status: FunctionStatus }
  | { type: 'done'; id: number; quick?: QuickInfo }
  | { type: 'fail'; id: number; error: string };

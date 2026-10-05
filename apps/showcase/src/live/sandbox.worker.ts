/**
 * The sandbox Web Worker: the prelude (messaging capture + browser-global scrub), then the engine's own Node worker
 * (packages/engine/src/sandbox/worker.ts) UNCHANGED, with `node:worker_threads` aliased to src/shims/worker_threads.ts.
 */
import './sandboxPrelude';
import '@faithful-engine-src/sandbox/worker.ts';

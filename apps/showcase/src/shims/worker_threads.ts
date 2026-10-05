/**
 * Browser stand-in for `node:worker_threads`, used ONLY inside the sandbox Web Worker (src/live/sandbox.worker.ts) so that
 * packages/engine/src/sandbox/worker.ts runs unchanged. `parentPort` talks to the page through the worker's own
 * postMessage / message events, captured by the prelude before the realm is hardened.
 *
 * `workerData.sab`: a plain 4-byte ArrayBuffer. The engine worker writes the index of the call in progress there with
 * Atomics.store; the page cannot read it (not shared), so the browser sandbox's watchdog uses the worker's chunk messages
 * as its heartbeat instead (src/live/browserSandbox.ts).
 */
import { captured } from '../live/sandboxPrelude';

type Listener = (m: unknown) => void;

export const parentPort = {
  postMessage(m: unknown): void {
    captured.post(m);
  },
  on(ev: string, f: Listener): void {
    if (ev === 'message') captured.onMessage(f);
  },
};

export const workerData = { sab: new ArrayBuffer(4) };
export const isMainThread = false;
export class Worker {
  constructor() {
    throw new Error('node:worker_threads Worker is not available in the browser');
  }
}
export default { parentPort, workerData, isMainThread, Worker };

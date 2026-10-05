/**
 * Runs first inside the sandbox Web Worker, before packages/engine/src/sandbox/{mask,worker}.ts.
 *
 * 1. Captures the worker's messaging (postMessage, the message event) into module-local bindings for the
 *    `node:worker_threads` shim, because the engine's mask shadows `postMessage` and the hardening below removes
 *    `addEventListener` from the reachable global scope.
 * 2. Removes browser-worker globals that the engine's TRAPPED list (written for Node) does not shadow, so candidate
 *    code cannot reach them as free identifiers: importScripts, location, indexedDB, caches, the event-target methods,
 *    and a few others. The engine's hardenRealm() then scrubs fetch, XMLHttpRequest, WebSocket ... as in Node, and its
 *    installMask() snapshots the resulting global key set.
 *
 * Accident-catching, not a security boundary (same honest limit as the Node worker thread, docs/SECURITY.md).
 */
const g = self as unknown as Record<string, unknown> & {
  postMessage(m: unknown): void;
  addEventListener(type: string, f: (e: MessageEvent) => void): void;
};

const post = g.postMessage.bind(g);
const listen = g.addEventListener.bind(g);

export const captured = {
  post(m: unknown): void {
    post(m);
  },
  onMessage(f: (m: unknown) => void): void {
    listen('message', (e: MessageEvent) => f(e.data));
  },
};

/** Browser-worker names candidate code must not reach as globals (in addition to the engine's TRAPPED / scrub lists). */
export const BROWSER_SCRUB = [
  'importScripts', 'location', 'indexedDB', 'caches', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'onmessage', 'onmessageerror', 'onerror', 'onlanguagechange', 'onunhandledrejection', 'onrejectionhandled',
  'reportError', 'requestAnimationFrame', 'cancelAnimationFrame', 'Notification', 'FileReader', 'FileReaderSync',
  'OffscreenCanvas', 'createImageBitmap', 'fonts', 'scheduler', 'trustedTypes', 'webkitRequestFileSystem',
  'webkitRequestFileSystemSync', 'webkitResolveLocalFileSystemURL', 'webkitResolveLocalFileSystemSyncURL', 'storage',
  'cookieStore', 'BroadcastChannel', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'name',
] as const;

export const scrubbed: string[] = [];
for (const n of BROWSER_SCRUB) {
  try {
    if (!(n in g)) continue;
    Object.defineProperty(g, n, { value: undefined, writable: false, configurable: false, enumerable: false });
    scrubbed.push(n);
  } catch {
    /* not configurable here: the engine's shadowing list does not cover it; recorded as not scrubbed */
  }
}

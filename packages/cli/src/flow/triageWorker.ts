/**
 * A triage worker (worker_threads), spawned by ./triagePool.ts; never imported by host code. It owns one `Sandbox` of its
 * own (opened on the first preflight), so a function that loops or crashes there cannot touch the server's thread or a
 * session's sandbox. It runs exactly the functions of ./triage.ts that the in-thread backend runs: same verdicts.
 *
 * Reads nothing and writes nothing: the pool sends it the file text (the server already read it, with its containment
 * checks) and it answers with statuses.
 */
import { parentPort } from 'node:worker_threads';
import { Sandbox } from '@faithful/engine';
import { classifyItems, quickInfo, type TriageDeps } from './triage.js';
import type { FromWorker, ToWorker } from './triageProtocol.js';

const port = parentPort;
if (!port) throw new Error('triageWorker.ts is a worker thread entry, not a module to import');
const post = (m: FromWorker): void => port.postMessage(m);

let sandbox: Promise<Sandbox> | null = null;
const openSandbox = (): Promise<Sandbox> =>
  (sandbox ??= Sandbox.open().catch((e: unknown) => {
    sandbox = null;
    throw e;
  }));

port.on('message', (m: ToWorker) => {
  void handle(m).catch((e: unknown) => post({ type: 'fail', id: m.id, error: e instanceof Error ? e.message : String(e) }));
});

async function handle(m: ToWorker): Promise<void> {
  if (m.op === 'quick') {
    post({ type: 'done', id: m.id, quick: quickInfo(m.text, () => post({ type: 'beat', id: m.id })) });
    return;
  }
  if (m.op === 'spin') {
    const until = Date.now() + m.ms;
    while (Date.now() < until);
    post({ type: 'done', id: m.id });
    return;
  }
  const deps: TriageDeps = {
    sandbox: openSandbox,
    // a preflight past its cap was aborted together with its sandbox (it kept a core busy): the next one opens a fresh one
    onAbandoned: () => {
      sandbox = null;
    },
    capMs: m.capMs,
    sample: m.sample,
  };
  await classifyItems(m.text, m.items, deps, {
    onStart: (name) => post({ type: 'start', id: m.id, name }),
    onResult: (name, status) => post({ type: 'result', id: m.id, name, status }),
  });
  post({ type: 'done', id: m.id });
}

post({ type: 'ready' });

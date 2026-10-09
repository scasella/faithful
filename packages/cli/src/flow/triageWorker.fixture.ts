/**
 * Test fixture, never part of the build: a triage worker that stalls (a synchronous loop) on a function named `stall` and
 * dies (process exit) on one named `crash`, and otherwise does what ./triageWorker.ts does. A `quick` request whose text
 * contains `// beats` works for 1400 ms while posting signs of life every 200 ms; one containing `// silent` says nothing for 4 s. Used by triagePool.test.ts to
 * check that the pool survives a worker that stops answering or dies, keeps what was decided, and carries on.
 */
import { parentPort } from 'node:worker_threads';
import { Sandbox } from '@faithful/engine';
import { classifyItems, quickInfo } from './triage.js';
import type { FromWorker, ToWorker } from './triageProtocol.js';

const port = parentPort!;
const post = (m: FromWorker): void => port.postMessage(m);
let sandbox: Promise<Sandbox> | null = null;
const open = (): Promise<Sandbox> => (sandbox ??= Sandbox.open());

port.on('message', (m: ToWorker) => {
  void (async () => {
    if (m.op === 'quick') {
      if (m.text.includes('// beats')) for (let i = 0; i < 7; i++) (await new Promise((r) => setTimeout(r, 200)), post({ type: 'beat', id: m.id }));
      if (m.text.includes('// silent')) await new Promise((r) => setTimeout(r, 4000));
      return post({ type: 'done', id: m.id, quick: quickInfo(m.text) });
    }
    if (m.op === 'spin') return post({ type: 'done', id: m.id });
    for (const it of m.items) {
      post({ type: 'start', id: m.id, name: it.name });
      if (it.name === 'stall') for (const end = Date.now() + 5000; Date.now() < end; );
      if (it.name === 'crash') process.exit(7);
      const r = await classifyItems(m.text, [it], { sandbox: open, capMs: m.capMs, sample: m.sample });
      post({ type: 'result', id: m.id, name: it.name, status: r[it.name]! });
    }
    post({ type: 'done', id: m.id });
  })();
});
post({ type: 'ready' });

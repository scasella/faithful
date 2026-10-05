// Builds public/recordings/dev-sample.json (+ .lean) from a REAL session log under docs/measurements, unchanged.
// It is a development sample, not a curated showcase recording: the orchestrator adds those later.
//
//   node scripts/make-dev-sample.mjs [sessionDir]
//
// Default session: docs/measurements/2026-10-05-proofs-final-heldout/sessions/numeric/clamp (proof run of `clamp`,
// held-out set, 2026-10-05). The events are copied byte-for-byte (parsed and re-serialized), nothing is added.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const dir = resolve(repo, process.argv[2] ?? 'docs/measurements/2026-10-05-proofs-final-heldout/sessions/numeric/clamp');
const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const start = events[0]?.event;
if (start?.kind !== 'session.started') throw new Error('first event is not session.started');
const rel = relative(repo, dir);
const rec = {
  schema: 1,
  fn: start.fn,
  stampedEvents: events,
  source: start.source,
  toolchain: start.toolchain,
  recordedAt: start.toolchain.capturedAt,
  notes:
    `DEV SAMPLE (not a curated showcase recording). A real session log copied unchanged from ${rel}/events.jsonl: ` +
    `a measurement run of the proof stage (select, translate, agree, prove, deliver), so it has no optimization candidates. ` +
    `Its user decisions (throw as a precondition, agreeing to the spec) were made by the scripted Autopilot policy ` +
    `(packages/cli/src/flow/autopilot.ts), not by a person reading the spec.`,
};
const out = join(here, '../public/recordings');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'dev-sample.json'), JSON.stringify(rec));
const lean = join(dir, `${start.fn}.lean`);
if (existsSync(lean)) copyFileSync(lean, join(out, 'dev-sample.lean'));
console.log(`wrote ${relative(repo, join(out, 'dev-sample.json'))} (${events.length} events)${existsSync(lean) ? ' and dev-sample.lean' : ''}`);

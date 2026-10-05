#!/usr/bin/env node
/**
 * Collect real optimization candidates for the candidate-proof experiment (docs/PROOFS.md, "Candidate proofs").
 * Rules: docs/measurements/2026-10-05-candidates/RULES.md. For every function with an agreed spec in the proof runs, replay
 * the chosen session up to the end of its original proof, run the real optimizer with the proof stage disabled, and keep
 * the candidates that pass compile, purity, differential and SMT-to-k and have a Lean model.
 *
 *   node scripts/collect-candidates.mjs --out docs/measurements/2026-10-05-candidates [--concurrency 3] [--only cls/fn,...]
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const out = resolve(root, opt('out', 'docs/measurements/2026-10-05-candidates'));
const concurrency = Number(opt('concurrency', 3));
const minutes = Number(opt('minutes', 10));
const rounds = Number(opt('rounds', 6));
const only = (opt('only', '') ?? '').split(',').filter(Boolean);

const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { SessionRuntime } = await imp('packages/cli/dist/flow/runtime.js');
const { Optimizer } = await imp('packages/cli/dist/flow/optimize.js');
const { translateCandidate } = await imp('packages/cli/dist/flow/candidateProof.js');
const { smtChecker } = await imp('packages/cli/dist/smtChecker.js');
const { openZ3 } = await imp('packages/smt/dist/index.js');
const { summarizeCalls } = await imp('packages/prover/dist/index.js');

const ORDER = ['final-heldout', 'tune-b-10x12', 'tune-d-simp', 'tune-d-simp-r2', 'tune-f-spechint', 'tune-c-guide', 'tune-d-simp-noguide', 'tune-a-high', 'tune-a-high-r2', 'tune-a-medium', 'tune-a-esc', 'tune-base-r2', 'low'];
const meas = join(root, 'docs/measurements');

/** fn id -> chosen session events (truncated) per RULES.md. */
function chooseSessions() {
  const byFn = new Map();
  for (const run of ORDER) {
    const dir = join(meas, `2026-10-05-proofs-${run}`, 'sessions');
    if (!existsSync(dir)) continue;
    for (const cls of readdirSync(dir)) for (const fn of readdirSync(join(dir, cls))) {
      const p = join(dir, cls, fn, 'events.jsonl');
      if (!existsSync(p)) continue;
      const evs = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const agreed = evs.some((e) => e.event.kind === 'spec.agreed');
      const proved = evs.some((e) => e.event.kind === 'proof.done' && e.event.theoremId === 'original_meets_spec' && e.event.result !== 'not-proved');
      if (!agreed) continue;
      const id = `${cls}/${fn}`;
      const cur = byFn.get(id);
      const rank = (proved ? 0 : 100) + ORDER.indexOf(run);
      if (!cur || rank < cur.rank) {
        const cut = evs.findIndex((e) => e.event.kind === 'optimize.started' || e.event.kind === 'deliver.done');
        byFn.set(id, { id, cls, fn, run, proved, rank, events: cut >= 0 ? evs.slice(0, cut) : evs });
      }
    }
  }
  return [...byFn.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

mkdirSync(join(out, 'base'), { recursive: true });
mkdirSync(join(out, 'collect-sessions'), { recursive: true });
const candPath = join(out, 'candidates.jsonl');
const exclPath = join(out, 'excluded.jsonl');
const logPath = join(out, 'collect.jsonl');
const done = new Set(existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
let items = chooseSessions().filter((s) => (!only.length || only.includes(s.id)) && !done.has(s.id));
console.log(`${items.length} functions, concurrency ${concurrency}`);
const z3 = await openZ3();

async function runOne(s) {
  const repo = mkdtempSync(join(tmpdir(), 'faithful-cands-'));
  mkdirSync(join(repo, '.faithful', s.fn), { recursive: true });
  const base = s.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(repo, '.faithful', s.fn, 'events.jsonl'), base);
  mkdirSync(join(out, 'base', s.cls), { recursive: true });
  writeFileSync(join(out, 'base', s.cls, `${s.fn}.events.jsonl`), base);
  const rt = new SessionRuntime({ repoRoot: repo, z3: z3.info() });
  rt.smt = smtChecker(z3);
  if (!(await rt.resume(s.fn))) throw new Error('resume failed');
  const t0 = performance.now();
  const opt = new Optimizer(rt, { threshold: { kind: 'time-budget', minutes }, maxRounds: rounds, skipProof: true });
  let stopped;
  try { stopped = await opt.run(); } catch (e) { stopped = 'error: ' + e.message; }
  await rt.close();
  const t = rt.translation;
  const ag = rt.state.agreement;
  const op = rt.state.proofs.find((p) => p.theoremId === 'original_meets_spec');
  const sc = summarizeCalls(rt.codex.calls);
  mkdirSync(join(out, 'collect-sessions', s.cls), { recursive: true });
  writeFileSync(join(out, 'collect-sessions', s.cls, `${s.fn}.events.jsonl`), rt.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  let kept = 0;
  for (const c of rt.state.optimize.candidates) {
    const st = Object.fromEntries(c.stages.map((x) => [x.stage, x.status]));
    const smt = c.stages.find((x) => x.stage === 'smt');
    const diff = c.stages.find((x) => x.stage === 'differential');
    const ct = translateCandidate(t, c.source);
    const sameRecords = ct.ok && (JSON.stringify(ct.lean.records ?? []) === JSON.stringify(t.lean.records ?? []) || !(t.lean.records?.length || ct.lean.records?.length));
    const row = {
      id: `${s.id}#${c.id}`, fnId: s.id, class: s.cls, fn: s.fn, candidateId: c.id, round: c.round, specSession: s.run, originalProved: s.proved,
      stages: st, smt: smt ? { status: smt.status, summary: smt.summary, k: smt.detail?.k } : null, differentialCompared: diff?.detail?.compared ?? null,
      translatable: ct.ok, refusal: ct.ok ? null : ct.refusal.reason, sameRecords, outcome: c.outcome, speedup: c.speedup,
      source: c.source,
    };
    const ok = st.compile === 'pass' && st.purity === 'pass' && st.differential === 'pass' && st.smt === 'pass' && ct.ok && sameRecords;
    if (ok) { kept++; appendFileSync(candPath, JSON.stringify({ ...row, specLean: ag.specLean, theoremExtra: rt.effectivePreconditions().theoremExtra, originalProof: op?.accepted ? { statement: op.statement, helpers: op.accepted.helpers, proof: op.accepted.proof } : null }) + '\n'); }
    else appendFileSync(exclPath, JSON.stringify(row) + '\n');
  }
  const log = { id: s.id, specSession: s.run, originalProved: s.proved, candidates: rt.state.optimize.candidates.length, kept, stopped, minutes: (performance.now() - t0) / 60000, codex: sc };
  appendFileSync(logPath, JSON.stringify(log) + '\n');
  console.log(`${s.id}: ${rt.state.optimize.candidates.length} candidates, ${kept} kept (${stopped}) ${log.minutes.toFixed(1)} min`);
}

const queue = [...items];
await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) { const s = queue.shift(); try { await runOne(s); } catch (e) { console.log(`${s.id}: FAILED ${e.stack}`); appendFileSync(logPath, JSON.stringify({ id: s.id, error: e.message }) + '\n'); } } }));
console.log('done');
process.exit(0);

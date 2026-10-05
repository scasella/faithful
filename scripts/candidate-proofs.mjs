#!/usr/bin/env node
/**
 * Candidate-proof harness (docs/PROOFS.md, "Candidate proofs"): run the production proof stage (`proveCandidate`, the same
 * function the optimizer's funnel calls) on dataset candidates, each in a session replayed from the dataset's base events
 * (agreement, carve-outs and the original's accepted proof exactly as recorded). Configuration comes from the same
 * environment variables / defaults as production (FAITHFUL_CANDIDATE_PROOF, FAITHFUL_CANDIDATE_GUIDE, FAITHFUL_PROOF_EFFORT).
 *
 *   node scripts/candidate-proofs.mjs --out <dir> [--data docs/measurements/2026-10-05-candidates] [--split tune|heldout|all]
 *        [--only id1,id2] [--attempts 8] [--minutes 12] [--concurrency 3]
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const data = resolve(root, opt('data', 'docs/measurements/2026-10-05-candidates'));
const out = resolve(root, opt('out', 'docs/measurements/candidate-proofs-run'));
const concurrency = Number(opt('concurrency', 3));
const attempts = Number(opt('attempts', 8));
const minutes = Number(opt('minutes', 12));
const splitSel = opt('split', 'all');
const only = (opt('only', '') ?? '').split(',').filter(Boolean);
/** `--lib v1`: the tactic set and library listing as they were before Faithful.Chk (the baseline). */
const lib = opt('lib', 'current');

const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { SessionRuntime } = await imp('packages/cli/dist/flow/runtime.js');
const { proveCandidate, candidateProofMode, candidateGuideDefault } = await imp('packages/cli/dist/flow/candidateProof.js');
const { summarizeCalls, proofEffortPolicy } = await imp('packages/prover/dist/index.js');

const cands = readFileSync(join(data, 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const split = existsSync(join(data, 'split.json')) ? JSON.parse(readFileSync(join(data, 'split.json'), 'utf8')) : null;
let items = cands.filter((c) => !only.length || only.includes(c.id) || only.includes(c.fnId));
if (splitSel !== 'all') {
  if (!split) throw new Error('no split.json');
  const fns = new Set(splitSel === 'tune' ? split.tune : split.heldout);
  items = items.filter((c) => fns.has(c.fnId));
}
mkdirSync(join(out, 'sessions'), { recursive: true });
const resultsPath = join(out, 'results.jsonl');
const done = new Set(existsSync(resultsPath) ? readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
items = items.filter((c) => !done.has(c.id));
const config = { lib, mode: candidateProofMode(), candidateGuide: candidateGuideDefault(), effort: proofEffortPolicy(), attempts, minutes, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('FAITHFUL_'))) };
writeFileSync(join(out, 'config.json'), JSON.stringify(config, null, 2));
console.log(`${items.length} candidates, concurrency ${concurrency}, config ${JSON.stringify(config)}`);

async function runOne(c) {
  const repo = mkdtempSync(join(tmpdir(), 'faithful-cproof-'));
  mkdirSync(join(repo, '.faithful', c.fn), { recursive: true });
  writeFileSync(join(repo, '.faithful', c.fn, 'events.jsonl'), readFileSync(join(data, 'base', c.class, `${c.fn}.events.jsonl`), 'utf8'));
  const rt = new SessionRuntime({ repoRoot: repo });
  if (lib === 'v1') {
    rt.proofImports = () => ['Faithful.TacticsV1'];
    const leanDir = join(root, 'lean');
    const core = readFileSync(join(leanDir, 'Faithful/Core.lean'), 'utf8');
    const simp = readFileSync(join(leanDir, 'Faithful/Simp.lean'), 'utf8');
    rt.librarySource = async () => `${core.trimEnd()}\n\n-- ===== Faithful.Simp (imported by Faithful.Tactics) =====\n${simp}`;
  }
  if (!(await rt.resume(c.fn))) throw new Error('resume failed');
  const nBase = rt.events.length;
  const t0 = performance.now();
  let stageRes = null;
  const r = await proveCandidate(rt, {
    source: c.source, id: c.candidateId, budget: { maxAttempts: attempts, minutes },
    reference: c.originalProof, done: async (s) => { stageRes = s; return s; },
  });
  const ms = performance.now() - t0;
  await rt.close();
  const sc = summarizeCalls(rt.codex.calls);
  const evs = rt.events.slice(nBase);
  const safe = c.id.replace(/[/#]/g, '_');
  writeFileSync(join(out, 'sessions', `${safe}.events.jsonl`), evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const d = stageRes?.detail ?? {};
  const row = {
    id: c.id, fnId: c.fnId, class: c.class, proved: r.proved, tier: r.tier ?? null, stage: stageRes?.status, summary: stageRes?.summary,
    attempts: d.attempts ?? 0, minutes: ms / 60000, mode: d.mode ?? 'single', equality: d.equality ?? null, range: d.range ?? null, combineFailed: !!d.combineFailed,
    stoppedBy: evs.filter((e) => e.event.kind === 'proof.done').map((e) => `${e.event.theoremId}:${e.event.stoppedBy}`),
    codex: { calls: sc.calls, failed: sc.failed, inputTokens: sc.inputTokens, outputTokens: sc.outputTokens, ms: sc.ms },
  };
  appendFileSync(resultsPath, JSON.stringify(row) + '\n');
  console.log(`${c.id}: ${r.proved ? 'PROVED' : 'not proved'} ${row.attempts} att ${row.minutes.toFixed(1)} min${row.equality ? ` eq=${row.equality.result} rg=${row.range?.result}` : ''}`);
}

const queue = [...items];
await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) { const c = queue.shift(); try { await runOne(c); } catch (e) { console.log(`${c.id}: FAILED ${e.stack}`); appendFileSync(resultsPath, JSON.stringify({ id: c.id, fnId: c.fnId, class: c.class, error: e.message }) + '\n'); } } }));
console.log('done');
process.exit(0);

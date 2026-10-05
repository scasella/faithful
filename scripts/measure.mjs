#!/usr/bin/env node
/**
 * Phase 9 measurement runner: the whole workflow (autopilot user policy) over a list of functions, `--concurrency` sessions at
 * a time (each with its own Codex subprocess queue, sandbox and temp repo). Writes one JSON line per function plus the session
 * files (events.jsonl, session.json, provenance) under --out. Real model, real Lean, real Z3; nothing is estimated.
 *
 *   node scripts/measure.mjs --corpus --out docs/measurements/2026-10-05 [--concurrency 4] [--minutes 6] [--only name1,name2]
 *   node scripts/measure.mjs --dir packages/translate/library-sample --out ...
 */
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, cpSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes('--' + n);
const out = opt('out', 'docs/measurements/run');
const concurrency = Number(opt('concurrency', 4));
const minutes = Number(opt('minutes', 6));
const proofAttempts = Number(opt('proof-attempts', 10));
const proofMinutes = Number(opt('proof-minutes', 12));
const only = opt('only', '')?.split(',').filter(Boolean) ?? [];
const noOptimize = flag('no-optimize');

const { runAutopilot } = await import(pathToFileURL(join(root, 'packages/cli/dist/flow/autopilot.js')).href);
const { translate, listExportedFunctions } = await import(pathToFileURL(join(root, 'packages/translate/dist/index.js')).href);
const smtMod = await import(pathToFileURL(join(root, 'packages/cli/dist/smtChecker.js')).href).catch(() => null);
const { openZ3 } = await import(pathToFileURL(join(root, 'packages/smt/dist/index.js')).href);

function entries() {
  const list = [];
  const base = flag('corpus') ? join(root, 'packages/translate/corpus') : join(root, opt('dir'));
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (!['GOLDEN', 'LICENSES'].includes(e.name)) walk(p); } else if (e.name.endsWith('.ts')) list.push(p); } };
  walk(base);
  return list.sort().flatMap((p) => {
    const src = readFileSync(p, 'utf8');
    const fns = listExportedFunctions(src).filter((f) => f.exported);
    const fn = fns.find((f) => f.name === basename(p, '.ts')) ?? fns[0];
    if (!fn) return [{ path: p, fn: basename(p, '.ts'), cls: relative(base, p).split('/')[0], noFn: true }];
    return [{ path: p, fn: fn.name, cls: relative(base, p).split('/')[0] }];
  });
}

mkdirSync(join(root, out, 'sessions'), { recursive: true });
const resultsPath = join(root, out, 'results.jsonl');
let items = entries().filter((e) => !only.length || only.includes(e.fn) || only.includes(`${e.cls}/${e.fn}`));
const done = new Set(existsSync(resultsPath) ? readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
items = items.filter((e) => !done.has(`${e.cls}/${e.fn}`));
console.log(`${items.length} functions to run, concurrency ${concurrency}, optimize ${!noOptimize}`);

let z3 = null;
try { z3 = await openZ3(); } catch {}

async function runOne(e) {
  const id = `${e.cls}/${e.fn}`;
  const src = readFileSync(e.path, 'utf8');
  const quick = translate(src, e.fn);
  if (!quick.ok) {
    const r = { id, class: e.cls, fn: e.fn, inSubset: false, refusal: { code: quick.refusal.code, reason: quick.refusal.reason, line: quick.refusal.span.line }, bestTier: 'refused', wallMs: 0, codex: { calls: 0 } };
    appendFileSync(resultsPath, JSON.stringify(r) + '\n');
    console.log(`${id}: refused (${quick.refusal.code})`);
    return;
  }
  const repo = mkdtempSync(join(tmpdir(), 'faithful-measure-'));
  mkdirSync(join(repo, 'src'));
  copyFileSync(e.path, join(repo, 'src/x.ts'));
  const { SessionRuntime } = await import(pathToFileURL(join(root, 'packages/cli/dist/flow/runtime.js')).href);
  const rt = new SessionRuntime({ repoRoot: repo, z3: z3?.info() ?? null });
  if (smtMod && z3) rt.smt = smtMod.smtChecker(z3);
  const { result } = await runAutopilot({ file: 'src/x.ts', fn: e.fn, repoRoot: repo, minutes, proofAttempts, proofMinutes, optimize: !noOptimize, runtime: rt });
  await rt.close();
  const dest = join(root, out, 'sessions', e.cls, e.fn);
  mkdirSync(dest, { recursive: true });
  if (existsSync(join(repo, '.faithful', e.fn))) cpSync(join(repo, '.faithful', e.fn), dest, { recursive: true });
  appendFileSync(resultsPath, JSON.stringify({ id, class: e.cls, ...result }) + '\n');
  console.log(`${id}: ${result.bestTier}${result.bestSpeedup ? ` ${result.bestSpeedup.ratio.toFixed(1)}x` : ''} proof=${result.originalProof?.result ?? '-'} calls=${result.codex.calls} ${(result.wallMs / 60000).toFixed(1)}min${result.error ? ' ERROR ' + result.error : ''}`);
}

const queue = [...items];
await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) { const e = queue.shift(); try { await runOne(e); } catch (err) { console.log(`${e.cls}/${e.fn}: FAILED ${err.message}`); appendFileSync(resultsPath, JSON.stringify({ id: `${e.cls}/${e.fn}`, class: e.cls, fn: e.fn, error: err.message }) + '\n'); } } }));
console.log('done');
process.exit(0);

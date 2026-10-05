// End-to-end check of the BUILT showcase from a plain static server. Not part of `pnpm test` (needs Chrome).
//
//   cd apps/showcase && pnpm exec vite build
//   node scripts/check.mjs                 # starts `python3 -m http.server` on dist/, drives installed Chrome headless
//   node scripts/check.mjs --url http://127.0.0.1:8742/   # use an already running static server instead
//   node scripts/check.mjs --no-coi        # block the service worker: checks that the page degrades (SMT not available)
//
// Asserts: the page loads without errors; the opener shows the function and the one line; the dev sample replays to
// its last event (the replay bar reaches "event N of N"); every replayed figure is labelled; the live checks run for
// the hand-written pair: the correct candidate passes compile/purity/differential(/smt), the wrong one is rejected
// with a counterexample shown live (differential), and, when isolated, Z3 also finds one when asked directly.
// Prints timings (JSON) for the report.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../ui/package.json'));
const { chromium } = require('playwright-core');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const noCoi = args.includes('--no-coi');
const shots = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : null;
const subdir = args.includes('--subdir');
let url = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;

let server = null;
if (!url) {
  const port = 8700 + Math.floor(Math.random() * 200);
  // --subdir: serve apps/showcase and open /dist/, to check that base './' really works below the server root.
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: join(here, subdir ? '..' : '../dist'), stdio: 'ignore' });
  url = `http://127.0.0.1:${port}/${subdir ? 'dist/' : ''}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
}

const failures = [];
const timings = {};
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: noCoi ? 'block' : 'allow' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => {
  // With service workers blocked by Playwright, register() resolves without a registration and the vendored
  // coi-serviceworker reads `.scope` of undefined. Real browsers without service workers skip registration instead.
  if (noCoi && /reading 'scope'/.test(e.message)) return;
  errors.push(`pageerror: ${e.message}`);
});
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`console: ${m.text()}`);
});
try {
  const t0 = Date.now();
  await page.goto(`${url}?r=dev-sample`, { waitUntil: 'load' });
  if (!noCoi) {
    await page.waitForFunction(() => window.crossOriginIsolated === true, null, { timeout: 20000 }).catch(() => {});
  }
  const isolated = await page.evaluate(() => window.crossOriginIsolated);
  timings.crossOriginIsolated = isolated;
  timings.isolatedAfterMs = Date.now() - t0;
  check(noCoi ? isolated === false : isolated === true, `cross-origin isolated = ${isolated} (expected ${!noCoi})`);
  timings.browser = `Chrome ${browser.version()}`;

  await page.waitForSelector('[data-testid="opener-line"]', { timeout: 20000 });
  const opener = await page.textContent('[data-testid="opener-line"]');
  check(/This works\. Let.s agree on what it does, then make it faster without changing that\./.test(opener ?? ''), 'opener line');
  check(((await page.textContent('.opener')) ?? '').includes('export function clamp'), 'opener shows the pasted function');
  check(((await page.textContent('[data-testid="replay-label"]')) ?? '').includes('replayed'), 'replay panel labelled replayed');
  check(await page.isVisible('[data-testid="dev-sample-banner"]'), 'dev sample banner shown');

  // Replay: it starts playing by itself (8x); wait for the first events, then seek to the end with the keyboard ("e").
  await page.waitForFunction(() => /event ([1-9]\d*) of 13/.test(document.querySelector('.replay')?.textContent ?? ''), null, { timeout: 15000 });
  check(true, 'replay plays on load (events delivered by the timed playback)');
  await page.keyboard.press('e');
  await page.waitForFunction(() => /event (\d+) of \1\b/.test(document.querySelector('.replay')?.textContent ?? ''), null, { timeout: 15000 });
  const bar = await page.textContent('.replay');
  check(/event 13 of 13/.test(bar ?? ''), `replay reached the end (${bar?.match(/event \d+ of \d+/)?.[0]})`);
  const shell = (await page.textContent('.replay-frame')) ?? '';
  check(/Deliver/.test(shell), 'replayed session reached Deliver');
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `replay-end${noCoi ? '-nocoi' : ''}.png`), fullPage: true });
  }

  // Live: wrong candidate first (must show a counterexample), then the correct one.
  const runOne = async (key) => {
    const a = Date.now();
    await page.click(`[data-testid="run-${key}"]`);
    await page.waitForFunction(
      (k) => {
        const el = document.querySelector(`[data-testid="live-cand-${k}"] [data-testid="live-run"]`);
        return el && el.getAttribute('data-state') !== 'running' && !document.querySelector(`[data-testid="run-${k}"]`)?.disabled;
      },
      key,
      { timeout: 180000 },
    );
    const stages = await page.$$eval(`[data-testid="live-cand-${key}"] .live-stages > li`, (els) =>
      els.map((e) => ({ stage: e.getAttribute('data-stage'), status: e.getAttribute('data-status'), ms: e.querySelector('.ms')?.textContent, sum: e.querySelector('.sum')?.textContent, facts: [...e.querySelectorAll('.facts li')].map((x) => x.textContent) })),
    );
    const state = await page.getAttribute(`[data-testid="live-cand-${key}"] [data-testid="live-run"]`, 'data-state');
    const label = await page.textContent(`[data-testid="live-cand-${key}"] .live-label`);
    return { wallMs: Date.now() - a, state, stages, label };
  };

  const wrong = await runOne('clamp-no-lower');
  timings.wrong = wrong;
  check(wrong.state === 'rejected', `wrong candidate rejected (state ${wrong.state})`);
  check(/ran in your browser just now/.test(wrong.label ?? ''), 'live result labelled "ran in your browser just now"');
  check(await page.isVisible('[data-testid="live-cand-clamp-no-lower"] [data-testid="live-counterexample"]'), 'counterexample shown live');
  const cxText = (await page.textContent('[data-testid="live-cand-clamp-no-lower"] [data-testid="live-counterexample"]')) ?? '';
  check(/value =/.test(cxText) && /Original returns/.test(cxText), `counterexample names the input (${cxText.replace(/\s+/g, ' ').slice(0, 160)})`);
  check(wrong.stages.find((s) => s.stage === 'translate')?.status === 'pass', 'live translation reproduces the recorded model hash');

  const right = await runOne('clamp-ternary');
  timings.right = right;
  check(right.state === 'passed', `correct candidate passes the live checks (state ${right.state})`);
  const smt = right.stages.find((s) => s.stage === 'smt');
  check(noCoi ? smt?.status === 'unavailable' : smt?.status === 'pass', `SMT stage ${smt?.status} (${smt?.sum})`);

  // SMT counterexample: the visitor's own candidate, wrong only where Z3 can see it, on a far input.
  if (!noCoi) {
    await page.fill('[data-testid="live-cand-yours"] textarea', `export function clamp(value: number, lo: number, hi: number): number {
  if (lo > hi) {
    throw new Error("clamp: lower bound exceeds upper bound");
  }
  if (value === 12345 && lo === -7) return hi + 1;
  return Math.min(Math.max(value, lo), hi);
}
`);
    const mine = await runOne('yours');
    timings.yoursSmtCatch = mine;
    const d = mine.stages.find((s) => s.stage === 'differential');
    const s = mine.stages.find((s) => s.stage === 'smt');
    check(d?.status === 'pass', `planted bug not hit by generated inputs (differential ${d?.status})`);
    check(s?.status === 'fail' && mine.state === 'rejected', `Z3 finds the planted bug live (smt ${s?.status}: ${s?.sum})`);
    const cx2 = (await page.textContent('[data-testid="live-cand-yours"] [data-testid="live-counterexample"]')) ?? '';
    check(/12345/.test(cx2) && /Z3 found this input/.test(cx2), 'SMT counterexample shown with the planted input');
  }

  // A visitor's endless loop must be stopped by the sandbox watchdog (worker terminated) within a bounded time.
  await page.fill('[data-testid="live-cand-yours"] textarea', `export function clamp(value: number, lo: number, hi: number): number {
  while (true) {}
}
`);
  const loop = await runOne('yours');
  timings.endlessLoop = { wallMs: loop.wallMs, state: loop.state, purity: loop.stages.find((x) => x.stage === 'purity') };
  check(loop.state === 'rejected' && loop.wallMs < 60000, `endless loop rejected in ${loop.wallMs} ms (${loop.stages.find((x) => x.stage === 'purity')?.sum})`);

  // Lean file: plain link to a file on the site, and its text.
  const href = await page.getAttribute('[data-testid="lean-link"]', 'href');
  check(href === 'recordings/dev-sample.lean', `Lean link ${href}`);
  const leanRes = await page.evaluate(async (h) => (await fetch(h)).status, href);
  check(leanRes === 200, `Lean file served (${leanRes})`);
  check(((await page.textContent('#lean-h + p + figure, #lean-h ~ figure')) ?? '').includes('theorem original_meets_spec'), 'Lean text shown');

  // Wording rules on the whole page.
  const all = (await page.textContent('body')) ?? '';
  // A percentage is a number followed by %; the only one allowed is "95% CI". (`%` alone is JavaScript's remainder
  // operator, which the SMT encoding note names.)
  const pct = [...all.matchAll(/\d[\d.,]*\s*%(?!\s*CI)/g)].map((m) => all.slice(Math.max(0, m.index - 30), m.index + 10));
  check(pct.length === 0, `no percentages except "95% CI" (${pct.slice(0, 3).join(' | ')})`);
  check(!/\b(score|grade)\b/i.test(all), 'no scores or grades');
  check(await page.isVisible('[data-testid="about"]'), 'About text present');
  if (shots) await page.screenshot({ path: join(shots, `live${noCoi ? '-nocoi' : ''}.png`), fullPage: true });

  // Recorded-candidate path. TEST-ONLY FIXTURE injected by page.route: the dev sample has no optimization candidates,
  // so this appends four hand-written events (a candidate with the wrong clamp from the examples) to the fetched
  // recording in this browser context only. Nothing is written to disk and the shipped site never shows them.
  // Own context with service workers blocked: requests answered by the COI service worker bypass page.route. Without
  // isolation the SMT stage cannot run, which also exercises the replayed-SMT fallback for a recorded candidate.
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => {
    if (/reading 'scope'/.test(e.message)) return;
    errors.push(`pageerror (recorded-candidate page): ${e.message}`);
  });
  await p2.route('**/recordings/dev-sample.json', async (route) => {
    const res = await route.fetch();
    const rec = await res.json();
    const last = rec.stampedEvents.at(-1);
    let seq = last.seq;
    const t = last.t;
    const src = 'export function clamp(value: number, lo: number, hi: number): number {\n  if (lo > hi) {\n    throw new Error("clamp: lower bound exceeds upper bound");\n  }\n  return value > hi ? hi : value;\n}\n';
    const smt = { stage: 'smt', status: 'fail', ms: 300, summary: 'TEST FIXTURE smt summary', detail: {} };
    const add = (event) => rec.stampedEvents.push({ seq: ++seq, t: t + seq, event });
    add({ kind: 'optimize.started', threshold: { kind: 'time-budget', minutes: 1 }, baseline: null, at: last.event.at ?? rec.recordedAt });
    add({ kind: 'candidate.proposed', candidate: { id: 1, round: 1, source: src, callId: null, stages: [], rejection: null, tier: null, outcome: 'running', bench: null, speedup: null } });
    add({ kind: 'stage.result', candidateId: 1, result: smt });
    add({ kind: 'candidate.decided', candidateId: 1, outcome: 'rejected', tier: null, rejection: { stage: 'smt', kind: 'other', reason: 'TEST FIXTURE' }, bench: null, speedup: null });
    const src2 = 'export function clamp(value: number, lo: number, hi: number): number {\n  if (lo > hi) {\n    throw new Error("clamp: lower bound exceeds upper bound");\n  }\n  return value < lo ? lo : value > hi ? hi : value;\n}\n';
    add({ kind: 'candidate.proposed', candidate: { id: 2, round: 1, source: src2, callId: null, stages: [], rejection: null, tier: null, outcome: 'running', bench: null, speedup: null } });
    add({ kind: 'stage.result', candidateId: 2, result: { ...smt, status: 'pass', summary: 'TEST FIXTURE: Verified to k=6' } });
    add({ kind: 'candidate.decided', candidateId: 2, outcome: 'not-faster', tier: null, rejection: null, bench: null, speedup: null });
    await route.fulfill({ response: res, json: rec });
  });
  await p2.goto(`${url}?paused&r=dev-sample`, { waitUntil: 'load' });
  await p2.waitForSelector('[data-testid="run-rec-1"]', { timeout: 20000 });
  await p2.click('[data-testid="run-rec-1"]');
  await p2.waitForFunction(() => {
    const el = document.querySelector('[data-testid="live-cand-rec-1"] [data-testid="live-run"]');
    return el && el.getAttribute('data-state') !== 'running' && !document.querySelector('[data-testid="run-rec-1"]')?.disabled;
  }, null, { timeout: 120000 });
  const recState = await p2.getAttribute('[data-testid="live-cand-rec-1"] [data-testid="live-run"]', 'data-state');
  check(recState === 'rejected' && (await p2.isVisible('[data-testid="live-cand-rec-1"] [data-testid="live-counterexample"]')), `recorded candidate runs live and is caught (${recState})`);
  check(/from the recording/.test((await p2.textContent('[data-testid="live-cand-rec-1"]')) ?? ''), 'recorded candidate labelled as from the recording');
  await p2.click('[data-testid="run-rec-2"]');
  await p2.waitForFunction(() => {
    const el = document.querySelector('[data-testid="live-cand-rec-2"] [data-testid="live-run"]');
    return el && el.getAttribute('data-state') !== 'running' && !document.querySelector('[data-testid="run-rec-2"]')?.disabled;
  }, null, { timeout: 120000 });
  const recSmt = (await p2.textContent('[data-testid="live-cand-rec-2"] [data-stage="smt"]')) ?? '';
  check(/replayed \(recorded on 2026-10-05 with Z3 5\.2\.0/.test(recSmt), `recorded SMT shown as replayed when Z3 cannot run (${recSmt.slice(0, 120)})`);
  await ctx2.close();


  // REAL recording with candidates (aliquotSum): the default recording of the shipped site. Its three recorded candidates run live.
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => {
    if (/reading 'scope'/.test(e.message)) return;
    errors.push(`pageerror (real recording page): ${e.message}`);
  });
  await p3.goto(`${url}?paused`, { waitUntil: 'load' });
  await p3.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 15000 }).catch(() => undefined);
  await p3.waitForSelector('[data-testid="run-rec-3"]', { timeout: 30000 });
  const body3 = (await p3.textContent('body')) ?? '';
  check(!(await p3.isVisible('[data-testid="dev-sample-banner"]')), 'the default recording is a real recording, not the dev sample');
  check(/aliquotSum/.test(body3), 'default recording is aliquotSum');
  for (const id of [1, 3]) {
    await p3.click(`[data-testid="run-rec-${id}"]`);
    await p3.waitForFunction((n) => {
      const el = document.querySelector(`[data-testid="live-cand-rec-${n}"] [data-testid="live-run"]`);
      return el && el.getAttribute('data-state') !== 'running' && !document.querySelector(`[data-testid="run-rec-${n}"]`)?.disabled;
    }, id, { timeout: 180000 });
  }
  const st1 = await p3.getAttribute('[data-testid="live-cand-rec-1"] [data-testid="live-run"]', 'data-state');
  const st3 = await p3.getAttribute('[data-testid="live-cand-rec-3"] [data-testid="live-run"]', 'data-state');
  check(st3 === 'passed', `recorded candidate 3 (the proved one) passes the live stages (${st3})`);
  check(st1 === 'passed' || st1 === 'stopped' || st1 === 'rejected', `recorded candidate 1 ran live (${st1})`);
  const t3 = (await p3.textContent('[data-testid="live-cand-rec-3"]')) ?? '';
  check(/ran in your browser just now/.test(t3) && /from the recording/.test(t3), 'live results labelled as live and the candidate as from the recording');
  await ctx3.close();

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
} catch (e) {
  failures.push(String(e));
  console.log('FAIL', e);
} finally {
  console.log('TIMINGS ' + JSON.stringify(timings, null, 1));
  await browser.close();
  server?.kill();
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');

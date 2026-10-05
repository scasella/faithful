// Keyboard-only end-to-end drive of the catch fixture (dev mode ?mock=catch&interactive). Not part of the test suite.
//
//   pnpm exec vite --port 5181 --strictPort        (in apps/ui, separately)
//   node scripts/drive.mjs <outDir> [baseUrl] [width] [theme]
//
// Select → Translate → Agree (carve out from the server's menu, agree in the confirmation) → Prove → Optimize → Deliver, using only
// page.keyboard (no clicks). A screenshot after every step. On every stage it also Tabs through the page and reports any
// focused element without a visible focus indicator (outline or box-shadow), and any element wider than the viewport.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'drive';
const base = process.argv[3] ?? 'http://127.0.0.1:5181/';
const width = Number(process.argv[4] ?? 1280);
const theme = process.argv[5] ?? 'light';
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
const page = await ctx.newPage();
const problems = [];
const log = (m) => console.log(m);
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));

let n = 0;
async function shot(name, fullPage = true) {
  const file = `drive-${String(++n).padStart(2, '0')}-${name}-${width}-${theme}.png`;
  await page.screenshot({ path: join(out, file), fullPage });
  log(`  shot ${file}`);
}
const key = async (k) => {
  if (/^[a-z0-9]$/.test(k)) {
    await page.waitForSelector(`[aria-keyshortcuts="${k}"]:not([disabled])`, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(60);
  }
  await page.keyboard.press(k);
  log(`  key ${k}`);
};
const type = async (t) => {
  await page.keyboard.type(t);
  log(`  type ${JSON.stringify(t)}`);
};
const stage = () => page.evaluate(() => document.querySelector('.stepper [aria-current="step"]')?.textContent ?? '');
const actionError = () => page.evaluate(() => document.querySelector('.err-inline[role="alert"]')?.textContent ?? null);

/** Tab through the page; every focused element must show a focus indicator. Restores focus to <body>. */
async function focusSweep(label, max = 200) {
  // Start from the top of the document: focus a temporary first element, Tab once, then remove it.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = '__sweep_start';
    document.body.prepend(b);
    b.focus();
  });
  const seen = new Set();
  let count = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow && cs.boxShadow !== 'none';
      const rect = el.getBoundingClientRect();
      const id = `${el.tagName.toLowerCase()}.${el.className}|${(el.textContent ?? '').trim().slice(0, 40)}|${Math.round(rect.top + scrollY)}`;
      return { id, visible: outline || shadow, inView: rect.width > 0 && rect.height > 0 };
    });
    if (i === 0) await page.evaluate(() => document.getElementById('__sweep_start')?.remove());
    if (!r) break;
    if (seen.has(r.id)) break;
    seen.add(r.id);
    count++;
    if (!r.visible) problems.push(`${label}: focus not visible on ${r.id}`);
    if (!r.inView) problems.push(`${label}: focused element has no box ${r.id}`);
  }
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  log(`  focus sweep ${label}: ${count} focusable elements checked`);
}

/** Elements wider than the viewport that are not inside a horizontal scroller. */
async function overflowSweep(label) {
  const bad = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 0.5) continue;
      let p = el.parentElement;
      let scrolled = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
          scrolled = true;
          break;
        }
        p = p.parentElement;
      }
      if (!scrolled && getComputedStyle(el).position !== 'fixed') out.push(`${el.tagName.toLowerCase()}.${el.className} right=${Math.round(r.right)}`);
    }
    return out.slice(0, 5);
  });
  for (const b of bad) problems.push(`${label}: wider than viewport: ${b}`);
}

async function check(label) {
  await overflowSweep(label);
  await focusSweep(label);
}

try {
  log(`drive at ${width}px, ${theme}`);
  await page.goto(`${base}?mock=catch&interactive`);
  await page.waitForSelector('.stepper');

  log('1. Select');
  await page.waitForSelector('input[type="search"], input');
  await shot('select-empty');
  await check('select');
  await key('/');
  await type('fib');
  await shot('select-typed');
  await key('Enter');
  await page.waitForFunction(() => /Propose a spec/.test(document.body.textContent ?? ''));

  log('2. Translate');
  await shot('translate');
  await check('translate');
  await key('n');
  await page.waitForFunction(() => document.querySelectorAll('.ag-ch').length >= 2, null, { timeout: 15000 });

  log('3. Agree');
  await shot('agree-unruled');
  await check('agree');
  await key('f');
  await key('c');
  await page.waitForSelector('.ag-carve-menu');
  await shot('agree-carve-menu');
  await key('1');
  // The carve-out ruling re-runs the challenge; the class covers both disagreements.
  await page.waitForFunction(() => /No disagreement\./.test(document.body.textContent ?? ''), null, { timeout: 8000 });
  await page.waitForSelector('[aria-keyshortcuts="a"]:not([disabled])');
  await shot('agree-ruled');
  await key('a');
  await page.waitForSelector('dialog[open]');
  await shot('agree-confirm', false);
  await key('Enter');
  await page.waitForFunction(() => /Prove original/.test(document.querySelector('.stepper [aria-current="step"]')?.textContent ?? ''));

  log('4. Prove');
  await shot('prove-budget');
  await check('prove');
  await key('p');
  await page.waitForFunction(() => /Lean accepted this proof/.test(document.body.textContent ?? ''), null, { timeout: 8000 });
  await page.waitForFunction(() => /Threshold|threshold/.test(document.body.textContent ?? ''));
  await shot('prove-done');
  await key('1');
  await key('o');

  log('5. Optimize');
  await page.waitForSelector('.catch', { timeout: 8000 });
  await shot('optimize-catch-moment', false);
  await page.waitForFunction(() => /Stopped:/.test(document.body.textContent ?? ''), null, { timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('optimize-stopped');
  await check('optimize');
  await key('d');
  await page.waitForFunction(() => /Deliver/.test(document.querySelector('.stepper [aria-current="step"]')?.textContent ?? ''));

  log('6. Deliver');
  await shot('deliver');
  await check('deliver');
  await key('1');
  await page.waitForTimeout(200);
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch((e) => `clipboard read failed: ${e}`));
  log(`  clipboard after key 1: ${JSON.stringify(copied)}`);

  log('7. Back through the stages with [');
  for (let i = 0; i < 5; i++) await key('[');
  log(`  shown stage after 5×[: ${await page.evaluate(() => document.querySelector('#screen-title')?.textContent)}`);
  await key('?');
  await shot('help-panel', false);
  await key('Escape');
  await page.keyboard.press('T');
  await page.waitForSelector('aside.tc');
  await page.waitForTimeout(100);
  await shot('toolchain-panel', false);
  await key('Escape');


} catch (e) {
  problems.push(`flow stopped: ${String(e).split('\n')[0]}`);
  await shot('FAILED');
  console.log(await page.evaluate(() => document.querySelector('main')?.innerText.slice(0, 3000)));
}
const err = await actionError();
if (err) problems.push(`action error on page: ${err}`);
log(`final stage: ${await stage()}`);
await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS');
  for (const p of problems) console.log(' - ' + p);
  process.exitCode = 1;
} else console.log('\nno problems');

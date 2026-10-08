// Screenshots of the Simple Pick step against a REAL server on a SMALL TEMP COPY of a repository (not a fixture), for
// docs/media/gui/simple/pick-first-*, pick-cannot-open-* and pick-tested-offer-*. Not part of the build or the tests.
//
//   node packages/cli/dist/bin.js --repo <a temp repo, no .git> --port <p> --no-open        (separately; a THROWAWAY dir:
//        opening a function writes <repo>/.faithful, so never point it at a real repository)
//   node scripts/shoot-pick-live.mjs <outDir> http://127.0.0.1:<p>/ <function to open for the Tested offer, e.g. distance>
//
// The temp repo this was made with (see docs/LAUNCH-NOTES.md, "Pick list over the whole repository") has: provable
// functions (clamp, digitSum, factorial), a float function that is Tested-only (distance: Math.sqrt), a function in a file
// with an import it does not use (countWords; its sibling lineId uses createHash and can't run), an overloaded function
// (pad), and one that never finishes (drain: "Checking took longer than 3 seconds; not run.").
//
// Never starts a model job: every request that is not part of listing/ranking or opening the function is ABORTED by a
// route guard (and reported), so a mistaken click cannot reach spec/propose, prove, optimize, tested/start or deliver.
// Each at 1280 and 375 wide, light and dark: <name>-<width>-<theme>.png. Reports horizontal overflow numerically.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots-pick';
const base = (process.argv[3] ?? 'http://127.0.0.1:5191/').replace(/\/?$/, '/');
const openName = process.argv[4] ?? 'distance';
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTHS = [1280, 375];
const THEMES = ['light', 'dark'];

// what the page may POST here: ranking, and opening a function (deterministic: translates, writes the temp repo only)
const ALLOWED_POST = [/^\/api\/functions\/(pick|status|scan\/start)$/, /^\/api\/session\/open$/];

async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 0.5) continue;
      let p = el.parentElement;
      let clipped = false;
      for (; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; }
      if (!clipped) wide.push(`${el.tagName.toLowerCase()}.${el.className} right=${Math.round(r.right)}`);
    }
    return { sw: document.documentElement.scrollWidth, cw: vw, wide: wide.slice(0, 5) };
  });
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const problems = [];
const refused = [];
let opened = false;

async function newPage(width, theme) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.route('**/api/**', (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== 'POST' || ALLOWED_POST.some((re) => re.test(path))) return route.continue();
    refused.push(`${req.method()} ${path}`);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${width} ${theme}: page error ${e.message}`));
  return { ctx, page };
}
const settled = (page) =>
  page.waitForFunction(
    () => document.querySelector('#s-results li') && !/Checking the repository|Checking…|Listing exported/.test(document.body.innerText),
    null,
    { timeout: 60000 },
  );
const shot = async (page, name, width, theme) => {
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const m = await measure(page);
  if (m.sw > m.cw || m.wide.length) problems.push(`${name} ${width} ${theme}: overflow sw=${m.sw} cw=${m.cw} ${m.wide.join(' | ')}`);
  await page.screenshot({ path: join(out, `${name}-${width}-${theme}.png`), fullPage: true });
};

// 1) the first screen once the scan has finished, then the can't-run list opened. No function is opened, so a fresh server is untouched.
for (const width of WIDTHS) {
  for (const theme of THEMES) {
    const { ctx, page } = await newPage(width, theme);
    await page.goto(`${base}?view=simple`);
    await settled(page);
    await shot(page, 'pick-first', width, theme);
    await page.getByRole('button', { name: /can't run/i }).first().click();
    await page.waitForSelector('.run-list li');
    await shot(page, 'pick-cannot-open', width, theme);
    await ctx.close();
  }
}

// 2) open one function (the float one: Tested only) once; the server keeps the session, so the other three pages load straight into it
for (const width of WIDTHS) {
  for (const theme of THEMES) {
    const { ctx, page } = await newPage(width, theme);
    await page.goto(`${base}?view=simple`);
    if (!opened) {
      await settled(page);
      await page.fill('#s-q', openName);
      await page.waitForFunction((n) => document.querySelector('#s-results li .s-res-name')?.textContent === n, openName, { timeout: 30000 });
      await page.waitForTimeout(400);
      await page.locator('#s-results li', { hasText: openName }).first().click();
      opened = true;
    }
    await page.waitForFunction(() => /only tested/.test(document.querySelector('h1')?.textContent ?? ''), null, { timeout: 30000 });
    await shot(page, 'pick-tested-offer', width, theme);
    await ctx.close();
  }
}
await browser.close();
if (refused.length) problems.push(`aborted requests (a model job would have started): ${[...new Set(refused)].join(', ')}`);
console.log(problems.length ? problems.join('\n') : 'no overflow, no page errors, no aborted requests');

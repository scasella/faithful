// Screenshots of the Simple view (src/simple/) for visual QA. Not part of the build or the test suite.
//
//   pnpm exec vite --port 5191 --strictPort        (in apps/ui, separately)
//   node scripts/shoot-simple.mjs <outDir> [baseUrl]
//
// Decision screens are reached by DRIVING the fixtures (?mock=<name>&interactive&view=simple: every click releases the
// fixture's next events), so their buttons are live; the moments while something runs (a proof, the candidate stream)
// are replays seeked with &at. Each at 1280 and 375 wide, light and dark: <n>-<moment>-<width>-<theme>.png.
// Reports horizontal overflow numerically (page scrollWidth vs clientWidth, and elements past the right edge).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots-simple';
const base = process.argv[3] ?? 'http://127.0.0.1:5191/';
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTHS = [1280, 375];
const THEMES = ['light', 'dark'];

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
for (const width of WIDTHS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${width} ${theme}: page error ${e.message}`));
    let n = 0;
    const shot = async (name) => {
      await page.mouse.move(0, 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      const m = await measure(page);
      if (m.sw > m.cw || m.wide.length) problems.push(`${name} ${width} ${theme}: overflow sw=${m.sw} cw=${m.cw} ${m.wide.join(' | ')}`);
      const file = join(out, `${String(++n).padStart(2, '0')}-${name}-${width}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
    };
    const h1 = (text) => page.waitForFunction((t) => document.querySelector('h1')?.textContent?.includes(t), text, { timeout: 15000 });
    const click = async (name) => {
      const b = page.getByRole('button', { name, exact: false }).first();
      await b.waitFor();
      await page.waitForFunction((el) => !el.disabled, await b.elementHandle(), { timeout: 15000 });
      await b.click();
    };

    // ── the catch fixture, driven ──
    await page.goto(`${base}?mock=catch&interactive&view=simple`);
    await h1('Which function');
    await page.waitForSelector('.s-results li');
    await page.fill('#s-q', 'fi');
    await shot('pick');
    await page.press('#s-q', 'Enter');
    await h1('Agree on what');
    await shot('propose');
    await click('Propose a spec');
    await h1('Who is right');
    await shot('disagreement');
    await click('Carve these inputs out');
    await page.waitForSelector('.s-options .s-btn');
    await shot('carve-menu');
    await click('Exclude inputs where n is negative');
    await h1('Agree to this spec');
    await shot('ready-to-agree');
    await click('Agree');
    await h1('Prove that');
    await shot('prove');
    await click('Prove it');
    await h1('Find a faster version');
    await shot('proved-faster-start');
    await click('Find a faster version');
    await h1('replaces the original');
    await shot('result');
    await click('Get the patch');
    await page.waitForSelector('.s-files');
    await shot('delivered');
    await click('Full view');
    await page.waitForSelector('[data-simple]');
    await shot('full-view-with-simple-button');

    // ── moments while something runs: replays seeked ──
    await page.goto(`${base}?mock=catch&at=proof.attempt&view=simple`);
    await h1('Proving');
    await shot('proving');
    await page.goto(`${base}?mock=catch&at=candidate.decided&view=simple`);
    await h1('Looking for a faster');
    await page.click('.s-cx-details > summary');
    await shot('optimizing-z3-catch');

    // ── the refused fixture, driven, then the Tested-only result ──
    await page.goto(`${base}?mock=refused&interactive&view=simple`);
    await h1('Which function');
    await page.waitForSelector('.s-results li');
    await page.click('.s-results li');
    await h1('only tested');
    await shot('refused');
    await page.goto(`${base}?mock=tested&view=simple`);
    await h1('replaces the original');
    await shot('tested-result');
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no overflow, no page errors');

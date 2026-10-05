// Screenshot sweep for visual QA. Not part of the build or the test suite.
//
//   pnpm exec vite --port 5181 --strictPort        (in apps/ui, separately)
//   node scripts/shoot.mjs <outDir> [baseUrl] [filter]
//
// For every fixture, every reachable stage, desktop (1280) and mobile (375), light and dark: one full-page PNG named
// <fixture>-<n>-<stage>-<width>-<theme>.png. Uses playwright-core with the locally installed Chrome (no download).
// Also reports, per shot, the page's scrollWidth vs clientWidth so horizontal overflow is caught numerically.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://127.0.0.1:5181/';
const filter = process.argv[4] ?? '';
mkdirSync(out, { recursive: true });

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STAGES = ['select', 'translate', 'agree', 'prove', 'optimize', 'deliver'];
const FIXTURES = ['catch', 'refused'];
const WIDTHS = [1280, 375];
const THEMES = ['light', 'dark'];

/** Page width, elements wider than the viewport outside a scroller (body has overflow-x hidden, so scrollWidth alone
 *  can hide them), and children of .stack/.stack-l that touch their previous sibling. */
async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 0.5 || getComputedStyle(el).position === 'fixed') continue;
      let p = el.parentElement;
      let clipped = false;
      for (; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') { clipped = true; break; }
      }
      if (!clipped) wide.push(`${el.tagName.toLowerCase()}.${el.className} right=${Math.round(r.right)}`);
    }
    const gaps = [];
    for (const st of document.querySelectorAll('.stack, .stack-l')) {
      const kids = Array.from(st.children).filter((k) => k.getBoundingClientRect().height > 0 && getComputedStyle(k).position !== 'absolute');
      for (let i = 1; i < kids.length; i++) {
        const a = kids[i - 1].getBoundingClientRect();
        const b = kids[i].getBoundingClientRect();
        if (b.top - a.bottom < 4 && b.top >= a.bottom - 1) gaps.push(`${kids[i].tagName.toLowerCase()}.${kids[i].className} after ${kids[i - 1].tagName.toLowerCase()}.${kids[i - 1].className}`);
      }
    }
    return { sw: document.documentElement.scrollWidth, cw: vw, wide: wide.slice(0, 5), gaps: gaps.slice(0, 8) };
  });
}

/** Intermediate states worth seeing on their own: [name, query, stage index or null for the current stage, open dialog]. */
const MOMENTS = [
  ['catch-moment', 'mock=catch&at=candidate.decided', null, false],
  ['agree-unruled', 'mock=catch&at=challenge.run', null, false],
  ['proof-running', 'mock=catch&at=proof.attempt', null, false],
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const problems = [];
for (const fx of FIXTURES) {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${fx} ${width} ${theme}: page error ${e.message}`));
      await page.goto(`${base}?mock=${fx}`);
      await page.waitForSelector('.stepper');
      const buttons = page.locator('.stepper button');
      for (let i = 0; i < STAGES.length; i++) {
        if (await buttons.nth(i).isDisabled()) continue;
        const name = `${fx}-${i + 1}-${STAGES[i]}-${width}-${theme}`;
        if (filter && !name.includes(filter)) continue;
        await buttons.nth(i).click();
        await page.mouse.move(0, 0);
        await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
        await page.evaluate(() => window.scrollTo(0, 0));
        const m = await measure(page);
        if (m.sw > m.cw) problems.push(`${name}: horizontal overflow ${m.sw} > ${m.cw}`);
        for (const b of m.wide) problems.push(`${name}: wider than viewport: ${b}`);
        for (const g of m.gaps) problems.push(`${name}: no vertical gap in a stack: ${g}`);
        await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
        console.log(`${name}.png  scrollWidth=${m.sw} clientWidth=${m.cw}`);
      }
      await ctx.close();
    }
  }
}
for (const [mname, query, , ] of MOMENTS) {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      const name = `moment-${mname}-${width}-${theme}`;
      if (filter && !name.includes(filter)) continue;
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(`${base}?${query}`);
      await page.waitForSelector('.stepper');
      await page.waitForTimeout(100);
      const m = await measure(page);
      if (m.sw > m.cw) problems.push(`${name}: horizontal overflow ${m.sw} > ${m.cw}`);
      for (const b of m.wide) problems.push(`${name}: wider than viewport: ${b}`);
      for (const g of m.gaps) problems.push(`${name}: no vertical gap in a stack: ${g}`);
      if (mname === 'catch-moment') {
        // The hero must be on screen without scrolling at the moment of the catch? Report where it starts.
        const top = await page.evaluate(() => Math.round(document.querySelector('.catch')?.getBoundingClientRect().top ?? -1));
        console.log(`${name}: catch card top at ${top}px (viewport 900)`);
      }
      await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
      console.log(`${name}.png`);
      await ctx.close();
    }
  }
}
await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS');
  for (const p of problems) console.log(' - ' + p);
  process.exitCode = 1;
}

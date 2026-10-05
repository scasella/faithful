// Read-only measurement: run the built translator on each drawn unit, print JSON rows. Does not change anything.
// Usage (after `pnpm exec tsc -b`): node packages/translate/library-sample/measure.mjs
import fs from 'node:fs';
import { translate, refusalStats } from '../dist/index.js';

const here = new URL('.', import.meta.url).pathname;
const draw = JSON.parse(fs.readFileSync(here + 'draw.json', 'utf8'));
const rows = [];
const results = [];
for (const L of draw.libraries) {
  for (const d of L.drawn) {
    const file = `${L.lib}/${d.name}.ts`;
    const source = fs.readFileSync(here + file, 'utf8');
    try {
      const r = translate(source, d.name);
      results.push(r);
      if (r.ok) rows.push({ name: d.name, lib: L.lib, file, ok: true });
      else {
        const s = r.refusal.span;
        rows.push({ name: d.name, lib: L.lib, file, ok: false, code: r.refusal.code, reason: r.refusal.reason, line: s?.line, at: s ? source.slice(s.start, Math.min(s.end, s.start + 80)) : '' });
      }
    } catch (e) {
      rows.push({ name: d.name, lib: L.lib, file, ok: false, code: 'crash', reason: String(e?.message ?? e).split('\n')[0] });
    }
  }
}
const hist = Object.fromEntries(Object.entries(refusalStats(results)).filter(([, n]) => n > 0));
const crashes = rows.filter((r) => r.code === 'crash').length;
console.log(JSON.stringify({ rows, inSubset: rows.filter((r) => r.ok).length, refused: rows.filter((r) => !r.ok).length, histogram: hist, crashes }, null, 2));

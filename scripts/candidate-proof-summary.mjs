#!/usr/bin/env node
/**
 * Summarize candidate-proof runs (docs/PROOFS.md, "Candidate proofs"):
 *   node scripts/candidate-proof-summary.mjs <run dir> [...] [--data docs/measurements/2026-10-05-candidates] [--split tune|heldout] [--exclude-refuted]
 * Per class: proved / candidates; split mode also counts the equality and range parts. Totals: attempts, minutes, Codex
 * calls and tokens. `--exclude-refuted` also reports the denominator without candidates whose range part is refuted by a
 * concrete input (range-screen.json).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const root = new URL('..', import.meta.url).pathname;
const data = resolve(root, opt('data') ?? 'docs/measurements/2026-10-05-candidates');
const splitSel = opt('split');
const dirs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--data', '--split'].includes(args[i - 1])));
const split = existsSync(join(data, 'split.json')) ? JSON.parse(readFileSync(join(data, 'split.json'), 'utf8')) : null;
const screen = existsSync(join(data, 'range-screen.json')) ? new Map(JSON.parse(readFileSync(join(data, 'range-screen.json'), 'utf8')).map((r) => [r.id, r])) : new Map();
const candInfo = new Map(readFileSync(join(data, 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((c) => [c.id, c]));
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

for (const dir of dirs) {
  let rows = readFileSync(join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  rows = [...new Map(rows.map((r) => [r.id, r])).values()];
  if (splitSel && split) { const fns = new Set(splitSel === 'tune' ? split.tune : split.heldout); rows = rows.filter((r) => fns.has(r.fnId)); }
  const cfg = existsSync(join(dir, 'config.json')) ? JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) : {};
  console.log(`\n== ${dir}  (${cfg.lib ?? '?'} lib, mode ${cfg.mode}, guide ${cfg.candidateGuide}, effort ${cfg.effort}, ${cfg.attempts}x${cfg.minutes})`);
  const classes = [...new Set(rows.map((r) => r.class))].sort();
  const line = (label, rs) => {
    const p = rs.filter((r) => r.proved);
    const eq = rs.filter((r) => r.equality?.result && r.equality.result !== 'not-proved').length;
    const rg = rs.filter((r) => r.range?.result && !['not-proved', 'not-attempted'].includes(r.range.result)).length;
    const refuted = rs.filter((r) => screen.get(r.id)?.refuted).length;
    const errs = rs.filter((r) => r.error).length;
    return `${label.padEnd(12)} proved ${p.length}/${rs.length}` + (rs.some((r) => r.mode === 'split') ? `  eq ${eq}  range ${rg}` : '') + `  refuted-range ${refuted}` + (errs ? `  ERRORS ${errs}` : '') +
      `  med.att(proved) ${median(p.map((r) => r.attempts)) ?? '-'}  med.min(proved) ${median(p.map((r) => r.minutes))?.toFixed(1) ?? '-'}` +
      `  attempts ${rs.reduce((s, r) => s + (r.attempts ?? 0), 0)}  min ${rs.reduce((s, r) => s + (r.minutes ?? 0), 0).toFixed(0)}  calls ${rs.reduce((s, r) => s + (r.codex?.calls ?? 0), 0)}` +
      `  tokens ${(rs.reduce((s, r) => s + (r.codex?.inputTokens ?? 0), 0) / 1e6).toFixed(2)}M/${(rs.reduce((s, r) => s + (r.codex?.outputTokens ?? 0), 0) / 1e3).toFixed(0)}k`;
  };
  for (const c of classes) console.log(line(c, rows.filter((r) => r.class === c)));
  console.log(line('orig proved', rows.filter((r) => candInfo.get(r.id)?.originalProved)));
  console.log(line('orig not', rows.filter((r) => !candInfo.get(r.id)?.originalProved)));
  console.log(line('TOTAL', rows));
  console.log('proved: ' + rows.filter((r) => r.proved).map((r) => r.id).join(', '));
}

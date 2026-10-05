#!/usr/bin/env node
/**
 * Summarize proof outcomes of one or more measure.mjs result directories (docs/PROOFS.md tables).
 *
 *   node scripts/proof-summary.mjs docs/measurements/2026-10-05-proofs-low [--only cls/fn,...] [--within 6,6] [--json]
 *
 * `--within A,M` also counts the proofs found at attempt <= A with proof-loop time <= M minutes: what the same run would have
 * proved under the smaller budget (the loop is budget-independent until the smaller budget is exhausted).
 *
 * Per class: proved / in-subset, blocked at agreement, median attempts and minutes of the proved ones; totals: Codex calls,
 * tokens, summed session wall time. Reads results.jsonl and each session's session.json (for per-attempt effort).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const only = (opt('only') ?? '').split(',').filter(Boolean);
const within = opt('within')?.split(',').map(Number) ?? null;
const dirs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--only', '--within'].includes(args[i - 1])));

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

for (const dir of dirs) {
  const rows = readFileSync(join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map(rows.map((r) => [r.id, r]));
  let list = [...byId.values()].filter((r) => r.inSubset);
  if (only.length) list = list.filter((r) => only.includes(r.id));
  const classes = ['numeric', 'array', 'string', 'recursive', 'refuse'];
  const out = { dir, classes: {}, total: null, proved: [], efforts: {} };
  const summarize = (rs) => {
    const proved = rs.filter((r) => r.originalProof && r.originalProof.result !== 'not-proved');
    return {
      inSubset: rs.length,
      proved: proved.length,
      blocked: rs.filter((r) => r.blockedAt).length,
      medianAttempts: median(proved.map((r) => r.originalProof.attempts)),
      medianMinutes: median(proved.map((r) => r.originalProof.minutes)),
      calls: rs.reduce((s, r) => s + (r.codex?.calls ?? 0), 0),
      inputTokens: rs.reduce((s, r) => s + (r.codex?.inputTokens ?? 0), 0),
      outputTokens: rs.reduce((s, r) => s + (r.codex?.outputTokens ?? 0), 0),
      wallMinutes: rs.reduce((s, r) => s + (r.wallMs ?? 0), 0) / 60000,
      proofMinutes: rs.reduce((s, r) => s + (r.originalProof?.minutes ?? 0), 0),
      errors: rs.filter((r) => r.error).length,
      within: within ? proved.filter((r) => r.originalProof.attempts <= within[0] && r.originalProof.minutes <= within[1]).length : null,
    };
  };
  for (const c of classes) {
    const rs = list.filter((r) => r.class === c);
    if (rs.length) out.classes[c] = summarize(rs);
  }
  out.total = summarize(list);
  out.proved = list.filter((r) => r.originalProof && r.originalProof.result !== 'not-proved').map((r) => `${r.id} (${r.originalProof.attempts} att, ${r.originalProof.minutes.toFixed(1)} min)`);
  for (const r of list) {
    const p = join(dir, 'sessions', r.class, r.fn, 'session.json');
    if (!existsSync(p)) continue;
    const s = JSON.parse(readFileSync(p, 'utf8'));
    for (const c of s.calls ?? []) if (c.purpose === 'proof-attempt') out.efforts[c.effort] = (out.efforts[c.effort] ?? 0) + 1;
  }
  if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); continue; }
  console.log(`\n${dir}`);
  const fmt = (n, s) => `${n.padEnd(10)} ${String(s.proved).padStart(2)}/${String(s.inSubset).padEnd(3)} blocked ${s.blocked}  med.att ${s.medianAttempts ?? '-'}  med.min ${s.medianMinutes?.toFixed(1) ?? '-'}  calls ${s.calls}  wall ${s.wallMinutes.toFixed(1)} min  proof ${s.proofMinutes.toFixed(1)} min  tokens in/out ${s.inputTokens}/${s.outputTokens}${s.within !== null ? `  within ${within.join('x')}: ${s.within}` : ''}${s.errors ? `  ERRORS ${s.errors}` : ''}`;
  for (const [c, s] of Object.entries(out.classes)) console.log(fmt(c, s));
  console.log(fmt('TOTAL', out.total));
  console.log('proved:', out.proved.join(', ') || '(none)');
  console.log('proof-attempt calls by effort:', JSON.stringify(out.efforts));
}

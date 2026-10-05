#!/usr/bin/env node
/**
 * Launch tables: GitHub-markdown summaries of the 2026-10-05 measurements, recomputed from the raw results every run.
 *
 *   node scripts/launch-tables.mjs                       # print markdown to stdout
 *   node scripts/launch-tables.mjs --write [path]        # replace the region between <!-- TABLES:START --> and
 *                                                        # <!-- TABLES:END --> in path (default docs/LAUNCH.md)
 *   node scripts/launch-tables.mjs --campaign <results.jsonl>   # read another campaign file (also FAITHFUL_CAMPAIGN)
 *
 * Counts only (no percentages). Every number comes from the files under docs/measurements; a section with no data prints
 * "not measured yet". The campaign file may be partial (still being appended to): unparseable lines are skipped and
 * counted, duplicate ids keep the last line.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const M_DIR = join(root, 'docs/measurements');
const campaignPath = resolve(root, opt('campaign') ?? process.env.FAITHFUL_CAMPAIGN ?? join(M_DIR, '2026-10-05-campaign/results.jsonl'));
const campaignDir = dirname(campaignPath);
const P = {
  low: join(M_DIR, '2026-10-05-proofs-low/results.jsonl'),
  heldout: join(M_DIR, '2026-10-05-proofs-final-heldout/results.jsonl'),
  library: join(M_DIR, '2026-10-05-library-sample/results.jsonl'),
  candSplit: join(M_DIR, '2026-10-05-candidates/split.json'),
};
const rel = (p) => { const r = relative(root, p); return !r ? p : r.startsWith('..') ? p : r; };

// ---------- loading ----------
function loadJsonl(path) {
  if (!existsSync(path)) return { rows: [], lines: 0, bad: 0, missing: true };
  const text = readFileSync(path, 'utf8'); // one read: a snapshot of a file that may still be growing
  const map = new Map();
  let lines = 0, bad = 0;
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    lines++;
    let r;
    try { r = JSON.parse(l); } catch { bad++; continue; }
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') { bad++; continue; }
    map.set(r.id, r);
  }
  return { rows: [...map.values()], lines, bad, missing: false };
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const camp = loadJsonl(campaignPath);
const low = loadJsonl(P.low);
const held = loadJsonl(P.heldout);
const lib = loadJsonl(P.library);
const candSplit = readJson(P.candSplit);

// Corpus size: the same walk measure.mjs --corpus uses (one function per .ts file, GOLDEN/LICENSES skipped).
function corpusFiles() {
  const base = join(root, 'packages/translate/corpus');
  const list = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (!['GOLDEN', 'LICENSES'].includes(e.name)) walk(p); } else if (e.name.endsWith('.ts')) list.push(p); } };
  if (existsSync(base)) walk(base);
  return list;
}
const corpusM = corpusFiles().length;

// ---------- helpers ----------
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const num1 = (x) => (x === null || x === undefined ? '-' : Number.isInteger(x) ? String(x) : x.toFixed(1));
const isProved = (r) => !!(r.originalProof && r.originalProof.result && r.originalProof.result !== 'not-proved');
const count = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); };
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const NOT_YET = '_not measured yet_';
const CLASS_ORDER = ['numeric', 'array', 'string', 'recursive', 'refuse'];
const classesOf = (rows) => [...new Set(rows.map((r) => r.class))].sort((a, b) => (CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99) || String(a).localeCompare(String(b)));
const ran = (r) => (r.codex?.calls ?? 0) > 0 || (r.wallMs ?? 0) > 0;

/** Ratio formatting: floor the estimate and the lower bound, ceil the upper bound (never round in the claim's favour). */
function truncStr(x, d) { const s = x.toFixed(d + 6); const i = s.indexOf('.'); return d === 0 ? s.slice(0, i) : s.slice(0, i + d + 1); }
function floorR(x, d) { return truncStr(x, d); }
function ceilR(x, d) {
  const t = truncStr(x, d);
  return Number(x.toFixed(d + 6)) > Number(t) ? (Number(t) + 10 ** -d).toFixed(d) : t;
}
function fmtSpeedup(s) {
  let d = Math.abs(s.ratio - 1) < 0.5 ? 2 : 1;
  while (s.lo > 1 && Number(floorR(s.lo, d)) <= 1 && d < 8) d++;
  return { est: `${floorR(s.ratio, d)}x`, ci: `${floorR(s.lo, d)}-${ceilR(s.hi, d)}` };
}

const out = [];
const p = (...xs) => out.push(...xs);

// ---------- 1. header ----------
const N = camp.rows.length;
const stamps = camp.rows.map((r) => r.stamp).filter(Boolean);
const dates = [...new Set(stamps.map((s) => s.date).filter(Boolean))].sort();
const models = [...new Set(stamps.map((s) => s.modelId).filter(Boolean))].sort();

async function toolchain() {
  const fromRows = stamps.map((s) => s.toolchain).filter(Boolean);
  if (fromRows.length) return { tc: fromRows, src: `the \`stamp.toolchain\` field of ${fromRows.length} campaign result(s)` };
  const sessFiles = [];
  const sdir = join(campaignDir, 'sessions');
  if (existsSync(sdir)) {
    const walk = (d, depth) => { for (const e of readdirSync(d, { withFileTypes: true })) { const q = join(d, e.name); if (e.isDirectory() && depth < 3) walk(q, depth + 1); else if (e.name === 'session.json') sessFiles.push(q); } };
    walk(sdir, 0);
  }
  const fromSess = sessFiles.map((f) => readJson(f)?.toolchain).filter(Boolean);
  if (fromSess.length) return { tc: fromSess, src: `the \`toolchain\` field of ${fromSess.length} campaign session.json file(s)` };
  try {
    const mod = await import(pathToFileURL(join(root, 'packages/core/dist/toolchain.js')).href);
    const tc = await Promise.race([mod.captureToolchain({}), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30_000).unref())]);
    return { tc: [tc], src: 'captured now, not from the run (no campaign result or session carries a toolchain yet)', now: true };
  } catch (e) {
    return { tc: [], src: `not available (no toolchain in the campaign data, and capturing it now failed: ${e.message})` };
  }
}
const tcInfo = await toolchain();
const tcKey = (t) => JSON.stringify([t.codex?.version, t.codex?.model, t.lean?.toolchain, t.lean?.mathlibCommit, t.z3?.kind, t.z3?.version, t.node, t.platform]);
const tcDistinct = [...new Map(tcInfo.tc.map((t) => [tcKey(t), t])).values()];

p('### Measurements', '');
p(`Campaign: \`${rel(campaignPath)}\`, ${N < corpusM ? `**partial: ${N} of ${corpusM} functions**` : `${N} of ${corpusM} functions`} (corpus size from \`packages/translate/corpus\`, the walk \`scripts/measure.mjs --corpus\` uses)${camp.bad ? `; unparseable lines: ${camp.bad}` : ''}${camp.missing ? '; file not found' : ''}.`, '');
const lowIds = new Set(low.rows.map((r) => r.id));
if (lowIds.size !== corpusM) p(`Note: the corpus walk finds ${corpusM} files but \`${rel(P.low)}\` has ${lowIds.size} distinct ids.`, '');
p(table(['field', 'value'], [
  ['date', dates.length ? dates.join(', ') + ' (campaign stamps)' : `${new Date().toISOString().slice(0, 10)} (today; no stamp in the campaign results yet)`],
  ['model', models.length ? models.map((m) => `\`${m}\``).join(', ') + ' (campaign stamps)' : NOT_YET],
  ...(tcDistinct.length ? tcDistinct.map((t, i) => [`toolchain${tcDistinct.length > 1 ? ` (${i + 1} of ${tcDistinct.length})` : ''}`,
    [`Codex CLI ${t.codex?.version ?? 'unknown'}`, `Lean ${t.lean?.toolchain ?? t.lean?.version ?? 'unknown'}`, `Mathlib \`${t.lean?.mathlibCommit ?? 'unknown'}\``,
      `Z3 ${t.z3 ? `${t.z3.version} (${t.z3.kind})` : 'not recorded'}`, `Node ${t.node ?? 'unknown'}`, t.platform ?? ''].filter(Boolean).join(', ')]) : [['toolchain', 'not available']]),
  ['toolchain source', tcInfo.src],
]), '');

// ---------- 2. subset coverage ----------
p('#### Subset coverage', '');
p(`Source: \`${rel(P.low)}\`, every corpus function (${low.rows.length}); the translator is deterministic, so this is the corpus's coverage.`, '');
if (!low.rows.length) p(NOT_YET, '');
else {
  const rows = classesOf(low.rows).map((c) => { const rs = low.rows.filter((r) => r.class === c); return [c, rs.length, rs.filter((r) => r.inSubset).length, rs.filter((r) => !r.inSubset).length]; });
  rows.push(['**total**', low.rows.length, low.rows.filter((r) => r.inSubset).length, low.rows.filter((r) => !r.inSubset).length]);
  p(table(['class', 'functions', 'in subset', 'refused'], rows), '');
  const mism = camp.rows.filter((r) => { const b = low.rows.find((x) => x.id === r.id); return b && r.inSubset !== undefined && (b.inSubset !== r.inSubset || (b.refusal?.code ?? null) !== (r.refusal?.code ?? null)); });
  p(`Cross-check against the campaign: ${camp.rows.filter((r) => lowIds.has(r.id)).length} campaign function(s) also in this run, ${mism.length} with a different subset verdict or refusal code${mism.length ? ': ' + mism.map((r) => r.id).join(', ') : ''}.`, '');
  p(`Refusals by code, corpus (${low.rows.filter((r) => !r.inSubset).length} refused of ${low.rows.length}; source as above):`, '');
  p(table(['refusal code', 'functions'], count(low.rows.filter((r) => !r.inSubset), (r) => r.refusal?.code ?? '(no code)')), '');
}
p(`Refusals by code, library sample (source: \`${rel(P.library)}\`, ${lib.rows.length} functions from es-toolkit, radash and remeda, ${lib.rows.filter((r) => r.inSubset).length} in subset):`, '');
if (!lib.rows.length) p(NOT_YET, '');
else {
  const sub = (r) => { const t = r.refusal?.reason ?? ''; if (/overload/i.test(t)) return 'overloaded function'; if (/runs code when the module loads/i.test(t)) return 'top-level statement (import / module-load code)'; if (/TS2304|Cannot find name/.test(t)) return 'missing module constant (does not type-check alone)'; return 'other'; };
  const rows = [];
  for (const [code, n] of count(lib.rows.filter((r) => !r.inSubset), (r) => r.refusal?.code ?? '(no code)')) {
    rows.push([code, n]);
    if (code === 'unsupported-syntax') for (const [b, k] of count(lib.rows.filter((r) => r.refusal?.code === code), sub)) rows.push([`&nbsp;&nbsp;of which: ${b}`, k]);
  }
  p(table(['refusal code', 'functions'], rows), '');
}

// ---------- 3. disagreements and rulings ----------
p('#### Disagreements and rulings', '');
const campIn = camp.rows.filter((r) => r.inSubset);
p(`Source: \`${rel(campaignPath)}\`, campaign functions in the subset (${campIn.length} so far). Rulings are made by the autopilot user policy (\`packages/cli/src/flow/autopilot.ts\`).`, '');
if (!campIn.length) p(NOT_YET, '');
else {
  const rul = campIn.flatMap((r) => r.rulings ?? []);
  const rk = (x) => x.ruling === 'function-wrong' && x.then ? `function wrong, then ${x.then}` : x.ruling === 'spec-wrong' ? 'spec wrong (revise)' : `${x.ruling}${x.then ? ', then ' + x.then : ''}`;
  p(table(['measure', 'count'], [
    ['functions with at least one spec proposal', campIn.filter((r) => (r.specProposals ?? 0) > 0).length],
    ['spec proposals (all, incl. revisions)', campIn.reduce((s, r) => s + (r.specProposals ?? 0), 0)],
    ['functions where the challenge search found a disagreement', campIn.filter((r) => (r.disagreementsFound ?? 0) > 0).length],
    ['functions with at least one ruling', campIn.filter((r) => (r.rulings ?? []).length).length],
    ...count(rul, rk).map(([k, n]) => [`rulings: ${k}`, n]),
    ...count(campIn.filter((r) => r.blockedAt), (r) => r.blockedAt).map(([k, n]) => [`blocked at ${k}`, n]),
    ['agreed on a spec', campIn.filter((r) => r.agreed).length],
  ]), '');
}

// ---------- 4. original-proof success ----------
p('#### Proving the original function', '');
function proofTable(rows) {
  const line = (label, rs) => {
    const pr = rs.filter(isProved);
    return [label, `${pr.length} of ${rs.length}`, rs.filter((r) => r.blockedAt).length, rs.filter((r) => r.originalProof).length, num1(median(pr.map((r) => r.originalProof.attempts))), num1(median(pr.map((r) => r.originalProof.minutes)))];
  };
  const body = classesOf(rows).map((c) => line(c, rows.filter((r) => r.class === c)));
  body.push(line('**total**', rows));
  return table(['class', 'proved of in subset', 'blocked at agreement', 'proof attempted', 'median attempts (proved)', 'median minutes (proved)'], body);
}
const lowIn = low.rows.filter((r) => r.inSubset);
p(`Baseline, effort \`low\`, 6 attempts / 6 minutes. Source: \`${rel(P.low)}\`, all in-subset corpus functions (${lowIn.length}).`, '');
p(lowIn.length ? proofTable(lowIn) : NOT_YET, '');
const heldIds = new Set(held.rows.map((r) => r.id));
const heldBefore = lowIn.filter((r) => heldIds.has(r.id));
p(`Held-out, before: the same baseline run restricted to the ${heldIds.size} held-out ids (the ids in \`${rel(P.heldout)}\`; the split rule in docs/PROOFS.md: in-subset ids sorted, 0-based index i with i mod 3 != 1).`, '');
p(heldBefore.length ? proofTable(heldBefore) : NOT_YET, '');
p(`Held-out, after: shipped defaults (effort \`high\`, guide, \`Faithful.Simp\`, 10 attempts / 12 minutes). Source: \`${rel(P.heldout)}\` (${held.rows.length} functions).`, '');
p(held.rows.length ? proofTable(held.rows.filter((r) => r.inSubset)) : NOT_YET, '');
p(`Campaign (shipped defaults). Source: \`${rel(campaignPath)}\`, campaign functions in the subset (${campIn.length} so far).`, '');
p(campIn.length ? proofTable(campIn) : NOT_YET, '');

p('Proving optimization candidates: one row per candidate-proof run. Source: `docs/measurements/2026-10-05-cproofs-<run>/results.jsonl` and its `config.json`; candidates from `docs/measurements/2026-10-05-candidates` (split.json: ' +
  (candSplit ? `${candSplit.tuneCandidates} TUNE candidates over ${candSplit.tune.length} functions, ${candSplit.heldoutCandidates} held-out candidates over ${candSplit.heldout.length} functions` : 'not found') + ').', '');
{
  const runs = existsSync(M_DIR) ? readdirSync(M_DIR).filter((d) => d.startsWith('2026-10-05-cproofs-') && existsSync(join(M_DIR, d, 'results.jsonl'))).sort() : [];
  if (!runs.length) p(NOT_YET, '');
  else {
    const tune = new Set(candSplit?.tune ?? []), ho = new Set(candSplit?.heldout ?? []);
    const body = runs.map((d) => {
      const { rows, bad } = loadJsonl(join(M_DIR, d, 'results.jsonl'));
      const cfg = readJson(join(M_DIR, d, 'config.json')) ?? {};
      const pr = rows.filter((r) => r.proved);
      const name = d.replace('2026-10-05-cproofs-', '') + (d.endsWith('final-default') ? ' (final config)' : '');
      const conf = `lib ${cfg.lib ?? '?'}, ${cfg.mode ?? '?'}, guide ${cfg.candidateGuide ? 'on' : 'off'}, effort ${(cfg.effort ?? ['?']).join(',')}, ${cfg.attempts ?? '?'} att / ${cfg.minutes ?? '?'} min`;
      const pop = `${rows.filter((r) => tune.has(r.fnId)).length} TUNE, ${rows.filter((r) => ho.has(r.fnId)).length} held-out`;
      return [`\`${name}\``, conf, `${pr.length} of ${rows.length}`, pop, count(pr, (r) => r.tier ?? 'none').map(([t, n]) => `${t} ${n}`).join(', ') || '-',
        num1(median(pr.map((r) => r.attempts))), num1(median(pr.map((r) => r.minutes))), (rows.filter((r) => r.error).length || 0) + (bad ? ` (+${bad} unparseable)` : '')];
    });
    p(table(['run', 'config', 'proved of attempted', 'attempted candidates', 'proved, by tier', 'median attempts (proved)', 'median minutes (proved)', 'errors'], body), '');
  }
}

// ---------- 5. candidate outcomes ----------
p('#### Optimization candidates', '');
const cands = camp.rows.flatMap((r) => (r.candidates ?? []).map((c) => ({ ...c, fnId: r.id })));
const optimized = camp.rows.filter((r) => Array.isArray(r.candidates) && (r.candidates.length || r.stoppedBy));
p(`Source: \`${rel(campaignPath)}\`, every candidate of every campaign function (${cands.length} candidates from ${optimized.length} function(s) that reached optimization).`, '');
if (!cands.length) p(NOT_YET, '');
else {
  const label = { incumbent: 'incumbent (accepted, best so far)', 'faster-not-proved': 'faster, not proved', 'accepted-at-verified': 'accepted at verified', rejected: 'rejected', 'not-faster': 'not faster', running: 'still running' };
  p(table(['outcome', 'candidates'], count(cands, (c) => c.outcome).map(([o, n]) => [label[o] ?? o, `${n} of ${cands.length}`])), '');
  const fnp = camp.rows.reduce((s, r) => s + (r.fasterNotProved ?? 0), 0);
  p(`Faster, not proved (sum of \`fasterNotProved\`): ${fnp} of ${cands.length} candidates, in ${camp.rows.filter((r) => (r.fasterNotProved ?? 0) > 0).length} function(s).`, '');
  const rej = cands.filter((c) => c.rejectionStage);
  p(rej.length ? table(['rejection stage', 'candidates'], count(rej, (c) => c.rejectionStage).map(([s, n]) => [s, `${n} of ${cands.length}`])) : 'Rejections by stage: none recorded.', '');
}

// ---------- 6. speedups ----------
p('#### Speedups', '');
const withSp = camp.rows.filter((r) => r.bestSpeedup && typeof r.bestSpeedup.ratio === 'number');
p(`Source: \`${rel(campaignPath)}\`, \`bestSpeedup\` (the accepted candidate against the original, 95% CI) of the ${withSp.length} campaign functions that have one. Ratios: estimate and lower bound rounded down, upper bound rounded up.`, '');
function distribution(r) {
  const s = readJson(join(campaignDir, 'sessions', r.class ?? '', r.fn ?? r.id.split('/').pop(), 'session.json'));
  const o = s?.optimize;
  const inc = o?.candidates?.find((c) => c.id === o.incumbentId);
  const d = inc?.bench?.distribution ?? o?.baseline?.distribution;
  return d ? String(d).replace(/\|/g, '\\|') : 'declared distribution of that function';
}
if (!withSp.length) p(NOT_YET, '');
else {
  const s = [...withSp].sort((a, b) => a.bestSpeedup.ratio - b.bestSpeedup.ratio);
  const mi = Math.floor((s.length - 1) / 2);
  const pick = [['best', s[s.length - 1]], [s.length % 2 ? 'median' : `median (lower middle of ${s.length})`, s[mi]], ['worst', s[0]]];
  p(table(['', 'speedup', '95% CI', 'function', 'tier', 'measured on'], pick.map(([k, r]) => { const f = fmtSpeedup(r.bestSpeedup); return [k, f.est, f.ci, r.id, r.bestTier ?? '-', distribution(r)]; })), '');
}

// ---------- 7. tiers ----------
p('#### Best result per function', '');
p(`Source: \`${rel(campaignPath)}\`, \`bestTier\` of every campaign function (${N}). \`refused\`: outside the subset; \`blocked\`: no agreed spec; \`none\`: nothing reached a tier.`, '');
p(N ? table(['best tier', 'functions'], count(camp.rows, (r) => r.bestTier ?? (r.error ? '(error)' : '(missing)')).map(([t, n]) => [t, `${n} of ${N}`])) : NOT_YET, '');

// ---------- 8. cost ----------
p('#### Session cost', '');
const ranRows = camp.rows.filter(ran);
p(`Source: \`${rel(campaignPath)}\`, campaign functions that ran a session (Codex calls or wall time above zero; ${ranRows.length} of ${N}).`, '');
if (!ranRows.length) p(NOT_YET, '');
else {
  const w = ranRows.map((r) => (r.wallMs ?? 0) / 60000), c = ranRows.map((r) => r.codex?.calls ?? 0);
  p(table(['measure', 'median', 'min', 'max', 'total'], [
    ['session wall time (minutes)', num1(median(w)), num1(Math.min(...w)), num1(Math.max(...w)), num1(w.reduce((a, b) => a + b, 0))],
    ['Codex calls', num1(median(c)), Math.min(...c), Math.max(...c), c.reduce((a, b) => a + b, 0)],
    ['Codex calls that failed', '', '', '', ranRows.reduce((s, r) => s + (r.codex?.failed ?? 0), 0)],
    ['input tokens (incl. cached)', '', '', '', ranRows.reduce((s, r) => s + (r.codex?.inputTokens ?? 0), 0)],
    ['output tokens', '', '', '', ranRows.reduce((s, r) => s + (r.codex?.outputTokens ?? 0), 0)],
  ]), '');
}

// ---------- 9. errors ----------
p('#### Errors', '');
const errs = camp.rows.filter((r) => r.error);
p(`Source: \`${rel(campaignPath)}\`, campaign functions whose result has an \`error\` (${N} results read${camp.bad ? `, ${camp.bad} unparseable line(s) skipped` : ''}).`, '');
p(N ? `${errs.length} of ${N}${errs.length ? ': ' + errs.map((r) => r.id).join(', ') : ''}.` : NOT_YET, '');

// ---------- assemble, self-check, emit ----------
const generated = `_Generated by \`node scripts/launch-tables.mjs --write\` on ${new Date().toISOString()}; do not edit by hand._`;
const md = [generated, '', ...out].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
if (md.split('95% CI').join('').includes('%')) throw new Error('self-check failed: output contains "%" outside "95% CI" (counts only)');
if (/proved for all inputs/i.test(md)) throw new Error('self-check failed: output says "proved for all inputs"');

const wi = args.indexOf('--write');
if (wi >= 0) {
  const next = args[wi + 1];
  const target = resolve(root, next && !next.startsWith('--') ? next : 'docs/LAUNCH.md');
  if (!existsSync(target)) { console.error(`launch-tables: ${target} does not exist`); process.exit(1); }
  const doc = readFileSync(target, 'utf8');
  const S = '<!-- TABLES:START -->', E = '<!-- TABLES:END -->';
  const lines = doc.split('\n');
  const si = lines.findIndex((l) => l.trim() === S), ei = lines.findIndex((l) => l.trim() === E);
  const missing = [si < 0 && S, ei < 0 && E].filter(Boolean);
  if (missing.length) { console.error(`launch-tables: ${rel(target)} is missing the marker line(s) ${missing.join(' and ')}; add them where the tables belong`); process.exit(1); }
  if (ei < si) { console.error(`launch-tables: in ${rel(target)}, ${E} comes before ${S}`); process.exit(1); }
  const res = [...lines.slice(0, si + 1), md.trimEnd(), ...lines.slice(ei)].join('\n');
  writeFileSync(target, res);
  console.error(`launch-tables: wrote the tables into ${rel(target)} (${N} campaign results${camp.bad ? `, ${camp.bad} unparseable line(s)` : ''})`);
} else process.stdout.write(md);

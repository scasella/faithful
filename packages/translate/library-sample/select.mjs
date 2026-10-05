// Reproducible draw of the Phase 9 library sample. Read-only over the clones; prints the pools and the draw as JSON.
// Usage: node packages/translate/library-sample/select.mjs /tmp/faithful-libs  [--pool]
// The selection rules are documented in README.md next to this file; this script is the executable form of them.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');

const ROOT = process.argv[2] ?? '/tmp/faithful-libs';
const SEED = 20261005;
const LIBS = [
  { lib: 'es-toolkit', srcRoot: 'es-toolkit/src', draw: 7 },
  { lib: 'radash', srcRoot: 'radash/src', draw: 7 },
  { lib: 'remeda', srcRoot: 'remeda/packages/remeda/src', draw: 6 },
];
const MAX_BODY_LINES = 40;
// Cheap textual impurity screen over the whole function text (signature + body).
const IMPURE = /\bconsole\b|\bfetch\b|\bprocess\b|Math\.random|\bDate\b|\bfs\b|\brequire\s*\(/;
const CLASSY = /\bclass\b/;
const ASYNCY = /\basync\b|\bawait\b/;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(tests?|__tests__|__test__|benchmarks?|bench)$/.test(e.name)) continue;
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.(test|spec|bench|test-d)\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const lineCount = (sf, node) =>
  sf.getLineAndCharacterOfPosition(node.getEnd()).line - sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const isExported = (n) => !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isAsync = (n) => !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

function candidates(file, relPath) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && isExported(st) && st.body) {
      // implementation signature of a (possibly overloaded) exported function: one pool entry per name
      found.push({ name: st.name.text, node: st, fnNode: st, body: st.body, kind: 'function' });
    } else if (ts.isVariableStatement(st) && isExported(st) && st.declarationList.flags & ts.NodeFlags.Const) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && ts.isArrowFunction(d.initializer)) {
          found.push({ name: d.name.text, node: st, fnNode: d.initializer, body: d.initializer.body, kind: 'arrow' });
        }
      }
    }
  }
  const pool = [];
  for (const c of found) {
    const fnText = c.node.getText(sf);
    const bodyLines = lineCount(sf, c.body);
    const reasons = [];
    if (bodyLines > MAX_BODY_LINES) reasons.push('body>40');
    if (isAsync(c.fnNode) || ASYNCY.test(fnText)) reasons.push('async');
    if (CLASSY.test(fnText)) reasons.push('class');
    if (IMPURE.test(fnText)) reasons.push('impure-text');
    pool.push({ path: relPath, name: c.name, kind: c.kind, bodyLines, excluded: reasons });
  }
  return pool;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const report = { seed: SEED, prng: 'mulberry32', libraries: [] };
for (const L of LIBS) {
  const base = path.join(ROOT, L.srcRoot);
  const libRoot = path.join(ROOT, L.lib);
  const all = [];
  for (const f of walk(base)) all.push(...candidates(f, path.relative(libRoot, f)));
  const cmp = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  all.sort(cmp);
  const pool = all.filter((c) => c.excluded.length === 0);
  const excl = {};
  for (const c of all) for (const r of c.excluded) excl[r] = (excl[r] ?? 0) + 1;
  const picked = [];
  const tries = [];
  while (picked.length < L.draw) {
    const i = Math.floor(rand() * pool.length);
    tries.push(i);
    if (!picked.includes(i)) picked.push(i);
  }
  report.libraries.push({
    lib: L.lib,
    exportedCandidates: all.length,
    excludedBy: excl,
    poolSize: pool.length,
    rawDraws: tries,
    drawnIndices: picked,
    drawn: picked.map((i) => ({ index: i, ...pool[i] })),
    ...(process.argv.includes('--pool') ? { pool: pool.map((c, i) => `${i}\t${c.path}\t${c.name}`) } : {}),
  });
}
console.log(JSON.stringify(report, null, 2));

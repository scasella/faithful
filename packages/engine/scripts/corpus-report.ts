/**
 * Corpus coverage report (markdown on stdout): which corpus functions are inside subset v1, which are refused and why,
 * where the translator disagrees with a corpus label, stamped with the date and toolchain (`captureToolchain()`).
 *
 * Run from the repo root, after a build (the script imports the compiled packages):
 *   pnpm exec tsc -b
 *   node --experimental-strip-types packages/engine/scripts/corpus-report.ts                 # coverage only (no Lean)
 *   node --experimental-strip-types packages/engine/scripts/corpus-report.ts --differential  # + tsVsLean, 300 inputs each
 * Options: --n <inputs> (default 300), --seed <int> (default 20261004).
 *
 * Reproducible: translate() is deterministic, the corpus is read in a fixed order, and input generation is seeded.
 * Only erasable TypeScript syntax here (Node's type stripping); imports point at dist/ because type stripping does not
 * rewrite `./x.js` to `./x.ts`.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureToolchain } from '@faithful/core';
import { translate, type TranslationResult } from '@faithful/translate';
import { CORPUS_CLASSES, KNOWN_TRANSLATOR_GAPS, loadCorpus } from '../dist/differential/corpus.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, '../../translate/corpus');

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const differential = argv.includes('--differential');
const N = Number(flag('--n') ?? 300);
const SEED = Number(flag('--seed') ?? 20261004);

const tc = await captureToolchain();
const entries = loadCorpus(CORPUS);
const results = new Map<string, TranslationResult>();
for (const e of entries) results.set(e.id, translate(e.source, e.fnName));

const out: string[] = [];
const p = (s = ''): void => {
  out.push(s);
};

p('## Corpus coverage (subset v1)');
p();
p(`Measured ${tc.capturedAt.slice(0, 10)} (${tc.capturedAt}). Toolchain: Node ${tc.node}, ${tc.platform}, ${tc.lean.version ?? "Lean not found"}` +
  ` (toolchain ${tc.lean.toolchain ?? '-'}), Mathlib ${tc.lean.mathlibCommit ?? '-'}, model id ${tc.codex.model} (not used: the translator makes no model call).`);
p(`Corpus: packages/translate/corpus, ${entries.length} files, labels written independently of the translator (\`// @corpus\` headers).`);
p();
p('| class | files | in subset | labeled ok, refused (translator gap) | labeled refuse, refused with the labeled code | label/translator mismatch |');
p('|---|---|---|---|---|---|');
let tot = { files: 0, ok: 0, gap: 0, refused: 0, mismatch: 0 };
const mismatches: string[] = [];
for (const c of CORPUS_CLASSES) {
  const es = entries.filter((e) => e.cls === c);
  let ok = 0, gap = 0, refused = 0, mismatch = 0;
  for (const e of es) {
    const r = results.get(e.id)!;
    if (r.ok) {
      ok++;
      if (e.header.expect !== 'ok') {
        mismatch++;
        mismatches.push(`${e.id}: labeled refuse/${e.header.code}, translated`);
      }
    } else if (e.header.expect === 'ok') {
      gap++;
      if (!KNOWN_TRANSLATOR_GAPS[e.id]) mismatches.push(`${e.id}: labeled ok, refused ${r.refusal.code} (not in the known-gap list)`);
    } else if (r.refusal.code === e.header.code) {
      refused++;
    } else {
      mismatch++;
      mismatches.push(`${e.id}: labeled refuse/${e.header.code}, refused ${r.refusal.code}`);
    }
  }
  tot = { files: tot.files + es.length, ok: tot.ok + ok, gap: tot.gap + gap, refused: tot.refused + refused, mismatch: tot.mismatch + mismatch };
  p(`| ${c} | ${es.length} | ${ok} | ${gap} | ${refused} | ${mismatch} |`);
}
p(`| **all** | **${tot.files}** | **${tot.ok}** | **${tot.gap}** | **${tot.refused}** | **${tot.mismatch}** |`);
p();
const labeledOk = entries.filter((e) => e.header.expect === 'ok').length;
p(`In subset: ${tot.ok} of ${tot.files} corpus functions. Of the ${labeledOk} labeled \`expect=ok\`, ${labeledOk - tot.gap} are accepted and ${tot.gap} are refused by the translator.`);
p();
p('### Refusals by code');
p();
p('| code | count | files |');
p('|---|---|---|');
const byCode = new Map<string, string[]>();
for (const e of entries) {
  const r = results.get(e.id)!;
  if (!r.ok) byCode.set(r.refusal.code, [...(byCode.get(r.refusal.code) ?? []), e.id]);
}
for (const [code, ids] of [...byCode].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))) {
  p(`| ${code} | ${ids.length} | ${ids.join(', ')} |`);
}
p();
p('### Translator gaps (labeled ok under the subset v1 text, refused by the translator)');
p();
for (const [id, g] of Object.entries(KNOWN_TRANSLATOR_GAPS)) {
  const r = results.get(id);
  const now = !r ? 'missing from corpus' : r.ok ? 'NOW ACCEPTED (update the list)' : `refused ${r.refusal.code}`;
  p(`- ${id}: ${now}. ${g.why}`);
}
p();
p('### Label/translator mismatches');
p();
p(mismatches.length ? mismatches.map((m) => `- ${m}`).join('\n') : 'None.');

if (differential) {
  const { Sandbox } = await import('../dist/sandbox/sandbox.js');
  const { tsVsLean } = await import('../dist/differential/differential.js');
  // The engine does not depend on the prover; this script wires it in (as the CLI does).
  const { evalBatch } = await import('../../prover/dist/lean.js');
  const sb = await Sandbox.open({ defaultTimeoutMs: 1000 });
  p();
  p(`### Differential: TypeScript original vs Lean model (tsVsLean, ${N} inputs per function, seed ${SEED})`);
  p();
  p('| function | inputs | model compared (ok / throw) | agreements | range-excluded (rangeOk agreed) | TS faults | too costly for Lean | disagreements |');
  p('|---|---|---|---|---|---|---|---|');
  const t = { inputs: 0, compared: 0, agree: 0, range: 0, rangeAgree: 0, faults: 0, costly: 0, dis: 0, fns: 0 };
  try {
    for (const e of entries) {
      const r = results.get(e.id)!;
      if (!r.ok) continue;
      const rep = await tsVsLean(r, { n: N, seed: SEED, perCallMs: 500 }, { lean: { evalBatch }, sandbox: sb });
      t.fns++;
      t.inputs += rep.underPreconditions;
      t.compared += rep.compared;
      t.agree += rep.agreements;
      t.range += rep.rangeExcluded;
      t.rangeAgree += rep.rangeOkAgreements;
      t.faults += rep.tsFaults;
      t.costly += rep.tooCostly;
      t.dis += rep.disagreements.length;
      p(`| ${e.id} | ${rep.underPreconditions} | ${rep.compared} (${rep.agreementTags.ok} / ${rep.agreementTags.throw}) | ${rep.agreements} | ${rep.rangeExcluded} (${rep.rangeOkAgreements}) | ${rep.tsFaults} | ${rep.tooCostly} | ${rep.disagreements.length} |`);
      for (const d of rep.disagreements.slice(0, 3)) p(`|  | disagreement (${d.kind}) on ${JSON.stringify(d.args)}: ${d.detail} |  |  |  |  |  |  |`);
    }
  } finally {
    await sb.close();
  }
  p(`| **${t.fns} functions** | **${t.inputs}** | **${t.compared}** | **${t.agree}** | **${t.range} (${t.rangeAgree})** | **${t.faults}** | **${t.costly}** | **${t.dis}** |`);
  p();
  p('TS faults (timeouts, stack overflow) are never counted as agreement and are not sent to Lean. Range-excluded inputs are outside ' +
    'the model; on each of them Lean `rangeOk`/`asciiOk`/`pre` was checked against the instrumented original. "Too costly": the TS call took ' +
    'more than 20 ms or returned more than 100,000 characters; such inputs are not evaluated in Lean and are not agreements.');
}

console.log(out.join('\n'));

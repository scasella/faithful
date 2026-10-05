/**
 * Corpus conformance suite: every file in packages/translate/corpus/<class>/ against its `// @corpus` header.
 *
 *  - expect=ok: translate() must accept, and `canThrow` must equal the `throws` header. EXCEPTION: the entries in
 *    KNOWN_TRANSLATOR_GAPS, where the corpus label is right under the subset v1 text but the translator is too narrow.
 *    They must be refused with exactly the listed code; the moment the translator accepts one, this test fails and
 *    the entry must be removed (it then gets the full treatment below). They are reported as findings, never hidden.
 *  - expect=refuse: refused with exactly the declared code, and the refusal span lies inside the exported function's
 *    declaration.
 *  - every translated entry: the emitted Lean equals the golden file packages/translate/corpus/GOLDEN/<class>/<name>.lean
 *    (UPDATE_GOLDEN=1 rewrites them); with Lean: the model compiles, every emitted definition depends on no axiom
 *    beyond the standard ones (tier `proved`, no sorryAx), and tsVsLean on 300 generated inputs shows zero
 *    disagreements (outcomes, and rangeOk/asciiOk/pre against the instrumented original on every input).
 *  - a summary table (per class: in subset / refused by code / translator gaps; inputs compared) is printed at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveLeanDir } from '@faithful/core';
import { translate, type RefusalCode, type TranslationResult } from '@faithful/translate';
import { Sandbox, liveSandboxWorkers } from './sandbox/sandbox.js';
import { loadCorpus, CORPUS_CLASSES, KNOWN_TRANSLATOR_GAPS, type CorpusEntry } from './differential/corpus.js';
import { tsVsLean, type LeanEvaluator, type TsVsLeanReport } from './differential/differential.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, '../../translate/corpus');
const GOLDEN = join(CORPUS, 'GOLDEN');
const N_INPUTS = 300;
const SEED = 20261004;

async function leanEvaluator(): Promise<LeanEvaluator> {
  const { evalBatch } = await import('../../prover/src/lean.js');
  return { evalBatch: (prelude, exprs, opts) => evalBatch(prelude, exprs, opts) };
}

const entries = loadCorpus(CORPUS);
const results = new Map<string, TranslationResult>();
for (const e of entries) results.set(e.id, translate(e.source, e.fnName));
const diffReports = new Map<string, TsVsLeanReport>();

function fnDeclRange(e: CorpusEntry): { start: number; end: number } {
  const sf = ts.createSourceFile('x.ts', e.source, ts.ScriptTarget.ES2022, true);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === e.fnName) return { start: st.getStart(sf), end: st.getEnd() };
    if (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === e.fnName)) {
      return { start: st.getStart(sf), end: st.getEnd() };
    }
  }
  throw new Error(`${e.id}: no declaration of ${e.fnName}`);
}

function goldenPath(e: CorpusEntry): string {
  return join(GOLDEN, e.cls, `${e.name}.lean`);
}

describe('corpus: headers vs translate()', () => {
  it('has a corpus with every class populated and unique ids', () => {
    expect(entries.length).toBeGreaterThan(50);
    for (const c of CORPUS_CLASSES) expect(entries.some((e) => e.cls === c), c).toBe(true);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const id of Object.keys(KNOWN_TRANSLATOR_GAPS)) expect(entries.some((e) => e.id === id), `gap entry ${id} exists`).toBe(true);
  });
  for (const e of entries) {
    it(`${e.id}: ${e.header.expect}${e.header.code ? ' ' + e.header.code : ''}`, () => {
      const r = results.get(e.id)!;
      const gap = KNOWN_TRANSLATOR_GAPS[e.id];
      if (gap) {
        expect(e.header.expect, `${e.id} is listed as a translator gap but is not expect=ok`).toBe('ok');
        expect(r.ok, `${e.id}: the translator now ACCEPTS this known gap; remove it from KNOWN_TRANSLATOR_GAPS`).toBe(false);
        if (!r.ok) expect(r.refusal.code).toBe(gap.code);
        return;
      }
      if (e.header.expect === 'ok') {
        expect(r.ok ? 'ok' : `refused ${r.refusal.code}: ${r.refusal.reason}`).toBe('ok');
        if (r.ok) expect(r.canThrow, `${e.id}: canThrow vs '// @corpus throws'`).toBe(e.header.throws);
      } else {
        expect(r.ok ? 'translated' : r.refusal.code, e.id).toBe(e.header.code);
        if (!r.ok) {
          const d = fnDeclRange(e);
          const s = r.refusal.span;
          expect(s.start, `${e.id}: span start ${s.start} inside [${d.start}, ${d.end}]`).toBeGreaterThanOrEqual(d.start);
          expect(s.end).toBeLessThanOrEqual(d.end);
          expect(s.end).toBeGreaterThanOrEqual(s.start);
          // line/column agree with the offsets
          const before = e.source.slice(0, s.start).split('\n');
          expect([s.line, s.column]).toEqual([before.length, before[before.length - 1]!.length + 1]);
          expect(r.refusal.reason.length).toBeGreaterThan(10);
        }
      }
    });
  }
});

const inSubset = entries.filter((e) => results.get(e.id)!.ok);

describe('corpus: golden Lean output', () => {
  for (const e of inSubset) {
    it(`${e.id}`, () => {
      const r = results.get(e.id)!;
      if (!r.ok) return;
      const p = goldenPath(e);
      if (UPDATE) {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, r.lean.source, 'utf8');
        return;
      }
      expect(existsSync(p), `missing golden ${p}; run with UPDATE_GOLDEN=1 to create it`).toBe(true);
      const golden = readFileSync(p, 'utf8');
      expect(r.lean.source === golden, `${e.id}: translator output drifted from ${p} (UPDATE_GOLDEN=1 regenerates after review)`).toBe(true);
    });
  }
});

describe.skipIf(!hasLean)('corpus: Lean compile + tsVsLean differential (real Lean)', () => {
  let sb: Sandbox;
  let lean: LeanEvaluator;
  beforeAll(async () => {
    sb = await Sandbox.open({ defaultTimeoutMs: 1000, memoryMb: 1024 });
    lean = await leanEvaluator();
  });
  afterAll(async () => {
    await sb.close();
    expect(liveSandboxWorkers()).toBe(0);
  });
  for (const e of inSubset) {
    it(
      `${e.id}: compiles without sorry; ${N_INPUTS} inputs, zero disagreements`,
      async () => {
        const t = results.get(e.id)!;
        if (!t.ok) return;
        const { checkLean } = await import('../../prover/src/lean.js');
        const defs = [...t.lean.source.matchAll(/^(?:def|theorem|structure|instance) (\S+)/gm)].filter((m) => !m[0].startsWith('structure') && !m[0].startsWith('instance')).map((m) => `Model.${m[1]}`);
        expect(defs).toContain(t.lean.names.original);
        expect(defs).toContain(t.lean.names.rangeOk);
        expect(defs).toContain(t.lean.names.pre);
        const c = await checkLean({ source: t.lean.source, theorems: defs, budgetMs: 180_000 });
        const errs = c.diagnostics.filter((d) => d.severity === 'error');
        expect(errs.map((d) => `${d.line}:${d.column} ${d.message}`)).toEqual([]);
        expect(c.ok).toBe(true);
        expect(t.lean.source).not.toMatch(/\bsorry\b|\bpartial\b|\bunsafe\b|\bnative_decide\b/);
        for (const d of defs) {
          expect(c.axioms[d], `axioms of ${d}`).toBeDefined();
          expect(c.axioms[d]!.axioms).not.toContain('sorryAx');
          expect(c.axioms[d]!.tier, `${d}: ${c.axioms[d]!.axioms.join(', ')}`).toBe('proved');
        }

        const rep = await tsVsLean(t, { n: N_INPUTS, seed: SEED, perCallMs: 500 }, { lean, sandbox: sb });
        diffReports.set(e.id, rep);
        expect(rep.excludedAccepted).toEqual([]);
        expect(rep.underPreconditions, `${e.id}: generator exhausted`).toBe(N_INPUTS);
        expect(rep.disagreements.slice(0, 5), JSON.stringify(rep.disagreements.slice(0, 5), null, 1)).toEqual([]);
        expect(rep.agreements + rep.rangeExcluded + rep.tsFaults + rep.tooCostly).toBe(rep.underPreconditions);
        expect(rep.compared, `${e.id}: no input inside the model`).toBeGreaterThan(0);
      },
      900_000,
    );
  }
});

afterAll(() => {
  const lines: string[] = [];
  const codes = new Map<string, Map<string, number>>();
  lines.push('');
  lines.push('Corpus summary (translate/corpus, ' + entries.length + ' files)');
  lines.push('| class | files | in subset | expected ok, refused (translator gap) | refused as labeled |');
  lines.push('|---|---|---|---|---|');
  for (const c of CORPUS_CLASSES) {
    const es = entries.filter((e) => e.cls === c);
    const ok = es.filter((e) => results.get(e.id)!.ok).length;
    const gaps = es.filter((e) => KNOWN_TRANSLATOR_GAPS[e.id]).length;
    const ref = es.filter((e) => !results.get(e.id)!.ok && !KNOWN_TRANSLATOR_GAPS[e.id]);
    const m = new Map<string, number>();
    for (const e of ref) {
      const r = results.get(e.id)!;
      if (!r.ok) m.set(r.refusal.code, (m.get(r.refusal.code) ?? 0) + 1);
    }
    codes.set(c, m);
    lines.push(`| ${c} | ${es.length} | ${ok} | ${gaps} | ${[...m].map(([k, v]) => `${k} ${v}`).join(', ') || '-'} |`);
  }
  const all = new Map<string, number>();
  for (const e of entries) {
    const r = results.get(e.id)!;
    if (!r.ok) all.set(r.refusal.code, (all.get(r.refusal.code) ?? 0) + 1);
  }
  lines.push(`Refusals by code (all ${[...all.values()].reduce((a, b) => a + b, 0)}): ${[...all].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (diffReports.size > 0) {
    let gen = 0, under = 0, compared = 0, agree = 0, range = 0, faults = 0, costly = 0, dis = 0;
    lines.push('| entry | inputs | compared (ok/throw) | agreements | range-excluded | ts faults | too costly for Lean | disagreements | ts ms | lean ms |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const [id, r] of diffReports) {
      gen += r.generated;
      under += r.underPreconditions;
      compared += r.compared;
      agree += r.agreements;
      range += r.rangeExcluded;
      faults += r.tsFaults;
      costly += r.tooCostly;
      dis += r.disagreements.length;
      lines.push(`| ${id} | ${r.underPreconditions} | ${r.compared} (${r.agreementTags.ok}/${r.agreementTags.throw}) | ${r.agreements} | ${r.rangeExcluded} | ${r.tsFaults} | ${r.tooCostly} | ${r.disagreements.length} | ${Math.round(r.tsMs)} | ${Math.round(r.leanMs)} |`);
    }
    lines.push(`tsVsLean totals over ${diffReports.size} functions: candidates generated ${gen}, inputs under ts preconditions ${under}, model outcomes compared ${compared}, agreements ${agree}, range-excluded (rangeOk checked) ${range}, TS faults (not sent to Lean) ${faults}, too costly for Lean (TS > 20 ms or result > 100k chars) ${costly}, disagreements ${dis}`);
  }
  console.log(lines.join('\n'));
});

/**
 * The landing page's recorded facts, checked against their sources: the showcase recordings (read from disk) and
 * docs/LAUNCH.md. If a recording or the report changes, this fails instead of the page going stale.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { TIER_LABEL, provedSentence } from '@faithful/core/tiers';
import { assertClaimsExact, visibleText } from '../test/text';
import { canSayFaster, outcomeVerb, valText } from '../lib/format';
import { CATCH, CLAMP_MODEL_CHECK_N, FASTER_NOT_PROVED, FIB, MEASURED, MEASURED_NOTE, TOOLCHAIN_STAMP } from './content';
import { Landing, fibSpeedupText, groupDigits } from './Landing';

interface Ev {
  kind: string;
  [k: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const rec = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../showcase/public/recordings/${name}.json`, import.meta.url), 'utf8')) as {
    source: string;
    toolchain: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    stampedEvents: { event: Ev }[];
  };
const launch = readFileSync(new URL('../../../../docs/LAUNCH.md', import.meta.url), 'utf8');

const events = (r: ReturnType<typeof rec>) => r.stampedEvents.map((s) => s.event);
const stage = (evs: Ev[], cand: number, st: string) => {
  const e = evs.find((x) => x.kind === 'stage.result' && x.candidateId === cand && x.result.stage === st);
  expect(e, `stage.result ${st} of candidate ${cand}`).toBeDefined();
  return e!.result;
};
const decided = (evs: Ev[], cand: number) => evs.find((x) => x.kind === 'candidate.decided' && x.candidateId === cand)!;

describe('landing: the clamp catch is the recorded one (clamp.json, candidate 2)', () => {
  const r = rec('clamp');
  const evs = events(r);

  it('candidate count, sources and removed check', () => {
    const proposed = evs.filter((e) => e.kind === 'candidate.proposed');
    expect(proposed.length).toBe(CATCH.candidateCount);
    const cand = proposed.find((e) => e.candidate.id === CATCH.candidateId)!.candidate;
    expect(CATCH.rewrite.filter((l) => !l.removed).map((l) => l.text).join('\n')).toBe(cand.source);
    expect(r.source).toContain(CATCH.original.join('\n'));
    // The struck-through lines are the original's, in order, and absent from the rewrite.
    const removed = CATCH.rewrite.filter((l) => l.removed).map((l) => l.text);
    expect(CATCH.original.join('\n')).toContain(removed.join('\n'));
    expect(cand.source).not.toContain(removed[0]!.trim());
    expect(cand.source).not.toContain(removed[1]!.trim());
  });

  it('gate results, counterexample and outcomes appear verbatim in the events', () => {
    for (const st of CATCH.passed) expect(stage(evs, CATCH.candidateId, st).status).toBe('pass');
    const diff = stage(evs, CATCH.candidateId, 'differential');
    expect(diff.summary).toBe(CATCH.differential);
    expect(diff.detail.compared).toBe(CATCH.compared);
    const smt = stage(evs, CATCH.candidateId, 'smt');
    expect(smt.summary).toBe(CATCH.smt);
    expect(smt.detail.result).toBe(CATCH.smtResult);
    const d = decided(evs, CATCH.candidateId);
    expect(d.outcome).toBe(CATCH.outcome);
    expect(d.rejection.counterexample.input).toEqual(CATCH.input);
    expect(d.rejection.counterexample.original).toEqual(CATCH.originalOutcome);
    expect(d.rejection.counterexample.candidate).toEqual(CATCH.candidateOutcome);
    expect(d.rejection.reason).toContain(JSON.stringify(CATCH.input));
    expect(valText(CATCH.input)).toBe('[-2, -1, -3]');
    expect(outcomeVerb(CATCH.originalOutcome)).toBe('throws "clamp: lower bound exceeds upper bound"');
    expect(outcomeVerb(CATCH.candidateOutcome)).toBe('returns -1');
    expect(r.source).toContain(`function clamp(${CATCH.params.map((p) => `${p}: number`).join(', ')})`);
  });

  it('the original was proved and N of its model check is the one shown', () => {
    expect(evs.find((e) => e.kind === 'proof.done' && e.theoremId === 'original_meets_spec')?.result).toBe('proved');
    expect(evs.find((e) => e.kind === 'model.checked' && e.check.subject === 'original')?.check.inputs).toBe(CLAMP_MODEL_CHECK_N);
  });

  it('the toolchain stamp is the recording’s', () => {
    const t = r.toolchain;
    expect(t.lean.toolchain).toBe('leanprover/lean4:v4.34.0');
    expect(TOOLCHAIN_STAMP[0]).toBe(`Lean 4.34.0 · Mathlib ${t.lean.mathlibCommit.slice(0, 7)}`);
    expect(TOOLCHAIN_STAMP[1]).toBe(`z3-solver ${t.z3.version} (WASM)`);
    expect(t.z3.kind).toBe('wasm');
    expect(TOOLCHAIN_STAMP[2]).toBe(`model ${t.codex.model} via Codex CLI ${t.codex.version.replace('codex-cli ', '')}`);
  });
});

describe('landing: the six gates are fibRecursive.json, candidate 1', () => {
  const evs = events(rec('fibRecursive'));
  const c = FIB.candidateId;

  it('stage timings, differential, SMT, benchmark and proof', () => {
    expect(stage(evs, c, 'compile').ms).toBe(FIB.compileMs);
    expect(stage(evs, c, 'purity').ms).toBe(FIB.purityMs);
    const diff = stage(evs, c, 'differential');
    expect(diff.summary).toBe(FIB.differential);
    expect(diff.detail.compared).toBe(FIB.compared);
    expect(diff.detail.skippedSlow).toBe(FIB.skippedSlow);
    expect(diff.detail.mutation).toMatchObject({ caught: FIB.mutantsCaught, total: FIB.mutantsTotal });
    const smt = stage(evs, c, 'smt');
    expect(smt.detail.k).toBe(FIB.k);
    expect(smt.detail.result).toBe(FIB.smtResult);
    expect(smt.summary.startsWith(`Verified to k=${FIB.k}:`)).toBe(true);
    expect(smt.summary).toContain(`NARROWED to ${FIB.narrowed}`);
    const bench = stage(evs, c, 'benchmark');
    expect(bench.summary).toBe(FIB.benchmark);
    expect(bench.detail.trials).toBe(FIB.trials);
    expect(bench.detail.distribution).toBe(FIB.distribution);
    expect(bench.detail.sizes).toEqual(FIB.sizes);
    const proof = stage(evs, c, 'proof');
    expect(proof.summary).toBe(FIB.proof);
    expect(proof.detail.attempts).toBe(FIB.proofAttempts);
    const d = decided(evs, c);
    expect(d.outcome).toBe(FIB.outcome);
    expect(d.tier).toBe(FIB.tier);
    expect(d.speedup).toEqual(FIB.speedup);
    expect(d.rejection.reason.startsWith(FIB.proof)).toBe(true);
  });

  it('the printed speedup is the recorded one, rounded outward, and "faster" is allowed', () => {
    const sp = fibSpeedupText();
    // the page groups digits (61,991×); the recorded summary does not
    expect(FIB.benchmark).toContain(`${sp.ratio} (${sp.ci})`.replace(/,/g, ''));
    expect(sp).toEqual({ ratio: '61,991×', ci: '95% CI 60,646–62,858' });
    expect(canSayFaster(FIB.speedup)).toBe(true);
  });
});

describe('landing: "What we measured" is docs/LAUNCH.md', () => {
  it('each count is in the report', () => {
    expect(launch).toContain('39 of 74 are in the\nsubset');
    expect(launch).toContain('0 of 20 are in the subset');
    const campaign = launch.slice(launch.indexOf('Campaign (shipped defaults)'));
    expect(campaign).toMatch(/\| \*\*total\*\* \| 20 of 39 \|/);
    expect(launch).toContain('| incumbent (accepted, best so far) | 3 of 130 |');
    expect(launch).toContain('| best | 1.6x | 1.6-1.8 | numeric/sign | proved |');
    expect(launch).toContain(`| faster, not proved | ${FASTER_NOT_PROVED} |`);
    expect(launch).toContain('26× for an aliquot sum, 60,000× for iterative Fibonacci');
    expect(launch).toMatch(/The machine was shared\./);
    expect(MEASURED.map((m) => m.value)).toEqual(['39 of 74', '0 of 20', '20 of 39', '3 of 130']);
    expect(MEASURED_NOTE).toContain('26× for an aliquot sum, 60,000× for iterative Fibonacci');
  });
});

describe('landing: rendered text', () => {
  for (const variant of ['showcase', 'local'] as const) {
    it(`${variant}: claim vocabulary, labels from core, recorded strings shown`, () => {
      const html = renderToString(h(Landing, { variant, onEnter: () => {} }));
      const text = visibleText(html);
      assertClaimsExact(text);
      for (const l of Object.values(TIER_LABEL)) expect(text).toContain(l);
      expect(text).toContain(provedSentence(CLAMP_MODEL_CHECK_N));
      expect(text).toContain(groupDigits(CATCH.differential));
      expect(text).toContain('1,000 inputs, no difference');
      expect(text).toContain(CATCH.smt);
      expect(text).toContain('[-2, -1, -3]');
      expect(text).toContain('throws "clamp: lower bound exceeds upper bound"');
      expect(text).toContain('returns -1');
      expect(text).toContain(FIB.proof);
      expect(text).toContain('61,991× (95% CI 60,646–62,858)');
      expect(text).not.toMatch(/\d{4,}×/); // every count grouped
      expect(text).toContain('n = 8, 16, 32');
      expect(text).toContain('Verified to k=6 narrowed to integers in [-8, 8]');
      expect(text).toContain('log scale');
      expect(html).not.toMatch(/GITHUB URL|\[[A-Z ]+URL\]/);
      if (variant === 'local') {
        expect(html).toMatch(/<label[^>]*><input type="checkbox"[^>]*\/?>Show this page when Faithful opens<\/label>/);
        expect(html).toMatch(/<button type="button"[^>]*>Open the app<\/button>/);
        expect(html).not.toContain('href="#replay"');
      } else {
        expect(html).toContain('href="#replay"');
        expect(html).toContain('href="#live"');
        expect(html).not.toContain('type="checkbox"');
      }
    });
  }
});

/**
 * The approved-design pass over the workspace screens: the candidate cards and gate chips (Optimize), "why this label",
 * a NARROWED SMT claim, the coverage panel and spec faults (Agree), and the receipt (Deliver). Built on the catch
 * fixture with single events changed, so each behaviour is pinned to the fact that drives it.
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent, StampedEvent } from '@faithful/session';
import { provedSentence } from '@faithful/core/tiers';
import { gateNote, narrowing } from '../components/gates';
import { assertClaimsExact, visibleText } from '../test/text';
import { CATCH, indexOf, render } from './prove/testutil';
import { AgreeScreen } from './agree/AgreeScreen';
import { coverageView } from './agree/gate';
import { fakeAdapter, renderScreen, storeWith } from './agree/testkit';

const NARROWED_SUMMARY =
  'Verified to k=6: Bounded SMT check (Z3) of the translator\'s IR. "unsat" means: Z3 found no input with every array of at most 6 elements, every string of at most 8 UTF-16 units of BMP text, and every number an integer in [-8, 8], on which the original stays inside the model. It says nothing about larger inputs. Coverage: the requested bounds had every number an integer in [-65536, 65536]; SOME INPUTS INSIDE THESE BOUNDS WERE EXCLUDED because a loop or recursion needs more than 10 iterations on them (for example [12]). The claim above is therefore NARROWED to integers in [-8, 8]: Z3 checked that no input inside the narrowed bounds needs more than 10 iterations.';

/** CATCH with one event replaced (or dropped, when `f` returns null). */
function edit(f: (e: SessionEvent) => SessionEvent | null): StampedEvent[] {
  return CATCH.flatMap((s) => {
    const e = f(s.event);
    return e ? [{ ...s, event: e }] : [];
  });
}

describe('Optimize: cards, gate chips, why this label', () => {
  it('one selectable card per candidate (a real button, aria-pressed), one chip per gate in the order met', () => {
    const { html, text } = render(CATCH, 'optimize');
    expect((html.match(/class="op-card-pick"/g) ?? []).length).toBe(3);
    expect((html.match(/aria-pressed="true"[^>]*aria-controls/g) ?? []).length).toBe(1);
    // stopped: the incumbent's detail is the one shown; the others are hidden tab panels, still rendered
    expect((html.match(/class="op-detail"[^>]*hidden/g) ?? []).length).toBe(2);
    const chips = html.match(/<ol class="funnel" aria-label="Checks for candidate 2">[\s\S]*?<\/ol>/)![0];
    expect(visibleText(chips).match(/Compile|Purity|Differential|Bounded Z3|Benchmark|Lean proof/g)).toEqual(['Compile', 'Purity', 'Differential', 'Bounded Z3', 'Benchmark', 'Lean proof']);
    expect(visibleText(chips)).toContain('unsat');
    expect(text).toContain('Current best');
    assertClaimsExact(text);
  });

  it('"why this label": the recorded reason verbatim, for a faster-not-proved candidate only', () => {
    const { html } = render(CATCH, 'optimize');
    const whys = html.match(/<section class="op-why"[\s\S]*?<\/section>/g) ?? [];
    expect(whys).toHaveLength(1);
    expect(visibleText(whys[0]!)).toContain('Not proved (3 attempts, 3.0 minutes): Lean could not prove that the candidate meets the agreed spec');
  });

  it('a NARROWED SMT claim states the narrowed bound, the requested one and an excluded input; the chip says it short', () => {
    const n = narrowing(NARROWED_SUMMARY)!;
    expect(n).toEqual({ narrowed: '-8, 8', requested: '-65536, 65536', example: '[12]', iterations: '10' });
    expect(gateNote({ stage: 'smt', status: 'pass', ms: 1, summary: NARROWED_SUMMARY })).toBe('Verified to k=6, narrowed to integers in [-8, 8]');
    expect(narrowing('no distinguishing input up to k=6')).toBeNull();
    const evs = edit((e) => (e.kind === 'stage.result' && e.candidateId === 3 && e.result.stage === 'smt' ? { ...e, result: { ...e.result, summary: NARROWED_SUMMARY } } : e));
    const text = render(evs, 'optimize').text;
    expect(text).toContain('Verified to k=6 here is narrowed to integers in [-8, 8]. The requested bound was [-65536, 65536], but inputs that need more than 10 loop iterations (for example [12]) were excluded');
    expect(text).toContain('Nothing is claimed for the excluded inputs.');
  });

  it('without a candidate incumbent, the original is the current best, with its Proved sentence', () => {
    const at = indexOf('incumbent.changed');
    const { html } = render(CATCH.slice(0, at), 'optimize');
    const box = visibleText(html.match(/<div class="op-incumbent[\s\S]*?<\/div>/)![0]);
    expect(box).toContain('The original.');
    expect(box).toContain(provedSentence(1000));
  });
});

describe('Agree: what any proof will cover, spec faults', () => {
  const run = (excluded: Record<string, number> | undefined) => ({ id: 2, specHash: 'h', inputsTried: 10, inputsCompared: 10, disagreements: [], ms: 1, seed: 1, ...(excluded ? { excluded: excluded as never } : {}) });

  it('counts carved-out inputs in words and numbers, warns when they are at least half, says when the count was not recorded', () => {
    expect(coverageView(run({ range: 0, throwPrecondition: 0, faults: 0, carvedOut: 300, generatedBeforeCarveOuts: 1000 }), 1)).toEqual({
      carvedLine: 'In run 2, the carve-outs exclude 300 of 1,000 generated inputs.',
      minority: false,
      specFaultLine: null,
    });
    expect(coverageView(run({ range: 0, throwPrecondition: 0, faults: 0, carvedOut: 500, generatedBeforeCarveOuts: 1000 }), 1).minority).toBe(true);
    // older recordings: absent or 0
    expect(coverageView(run({ range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0 }), 2).carvedLine).toBe('How many generated inputs the carve-outs exclude was not recorded in run 2.');
    expect(coverageView(run({ range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0, generatedBeforeCarveOuts: 0 }), 2).minority).toBe(false);
    expect(coverageView(run(undefined), 0).carvedLine).toBeNull();
    expect(coverageView(run({ range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0, specFaults: 3 }), 0).specFaultLine).toBe('Three inputs not compared: Lean produced no value for the spec on them.');
  });

  it('the panel on screen: preconditions, the carve-out verbatim, the minority warning, no percentages', () => {
    const evs = edit((e) =>
      e.kind === 'challenge.run' && e.run.id === 2 ? { ...e, run: { ...e.run, excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 600, generatedBeforeCarveOuts: 1000, specFaults: 2 } } } : e,
    );
    const store = storeWith(evs.slice(0, CATCH.findIndex((x) => x.event.kind === 'spec.agreed')));
    const html = renderScreen(AgreeScreen, store, fakeAdapter());
    const panel = visibleText(html.match(/<section class="ag-cover[\s\S]*?<\/section>/)![0]);
    expect(panel).toContain('Preconditions, always on');
    expect(panel).toContain('inputs where n is negative are excluded from everything proved below.');
    expect(panel).toContain('the carve-outs exclude 600 of 1,000 generated inputs');
    expect(panel).toContain('any proof will cover at most half of what the challenge generated');
    expect(panel).toContain('Two inputs not compared: Lean produced no value for the spec on them.');
    expect(html).toMatch(/class="ag-cover minority"/);
    assertClaimsExact(visibleText(html));
  });

  it('an old recording\'s spec fault is labelled an evaluation fault, and "my function is wrong" carries a caution', () => {
    const evs = edit((e) =>
      e.kind === 'challenge.run' && e.run.id === 1
        ? { ...e, run: { ...e.run, disagreements: e.run.disagreements.map((c, i) => (i === 0 ? { ...c, spec: { tag: 'fault' as const, detail: 'no output from Lean' } } : c)) } }
        : e,
    );
    const store = storeWith(evs.slice(0, CATCH.findIndex((x) => x.event.kind === 'challenge.run') + 1));
    const text = visibleText(renderScreen(AgreeScreen, store, fakeAdapter()));
    expect(text).toContain('Evaluation fault of the spec.');
    expect(text).toContain('They disagree on 1 input.');
    expect(text).toContain('Lean produced no value for the spec: an evaluation fault of the spec, not a disagreement.');
  });
});

describe('Deliver: the receipt', () => {
  it('carve-outs dominate, verbatim, before the speedup; then the claim with provedSentence, theorem facts and evidence by gate', () => {
    const { text, html } = render(CATCH, 'deliver');
    const band = html.indexOf('carve-receipt');
    const speed = html.indexOf('class="dl-speed"');
    expect(band).toBeGreaterThan(-1);
    expect(band).toBeLessThan(speed);
    expect(text).toContain('One class of inputs was carved out during agreement.');
    expect(text).toContain('inputs where n is negative are excluded from everything proved below.');
    expect(text).toContain(provedSentence(1000));
    expect(text).toContain('Axioms: propext, Classical.choice, Quot.sound · 2 attempts');
    expect(text).toContain('Evidence, by gate');
    expect(text).toMatch(/Bounded Z3\s*no distinguishing input up to k=6/);
    assertClaimsExact(text);
  });

  it('the carve-outs stay next to every label: on Optimize (the band) and on a delivery with no candidate', () => {
    expect(render(CATCH, 'optimize').html).toMatch(/<aside class="carve-band"[\s\S]*inputs where n is negative/);
    const none = edit((e) => (e.kind === 'incumbent.changed' ? null : e.kind === 'candidate.decided' && e.candidateId === 2 ? { ...e, outcome: 'not-faster' as const } : e));
    const { html, text } = render(none, 'deliver');
    expect(text).toContain('No candidate delivered');
    expect(html).toContain('carve-receipt');
    expect(text).not.toContain('A proof on this page');
  });

  it('"Left on the table": faster candidates that were not proved, with their labels and reasons', () => {
    const { text } = render(CATCH, 'deliver');
    expect(text).toContain('Left on the table');
    expect(text).toMatch(/Candidate 3\s*Verified to k=6\s*5\.1× \(95% CI 4\.7–5\.5\)/);
    expect(text).toContain('Not proved (3 attempts, 3.0 minutes)');
    expect(text).toContain('never delivered under a stronger label');
  });

  it('a weak mutation check gets a short muted note with its numbers; the verify copy says what it re-runs', () => {
    const weak = edit((e) =>
      e.kind === 'stage.result' && e.candidateId === 2 && e.result.stage === 'differential'
        ? { ...e, result: { ...e.result, detail: { ...e.result.detail, mutation: { caught: 2, total: 12, undistinguished: 9, seed: 11 } } } }
        : e,
    );
    const text = render(weak, 'deliver').text;
    expect(text).toContain('Only 2 of 12 broken copies of the original were caught by the differential inputs');
    expect(render(CATCH, 'deliver').text).not.toContain('Only 12 of 12');
    expect(text).toContain('recompute every hash in the provenance file, re-run Lean on the proof file (its axioms included), re-run the differential test and, when Z3 is available, the bounded SMT check, and print the evidence line again');
  });
});

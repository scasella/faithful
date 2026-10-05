import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { replay, type CandidateRecord, type SessionState } from '@faithful/session';
import { provedSentence } from '@faithful/core/tiers';
import { Evidence } from './Evidence';
import { evidenceFor, evidenceText } from '../lib/evidence';
import { catchFixture } from '../fixtures/catch';
import { assertClaimsExact, visibleText } from '../test/text';

const state = replay(catchFixture.events);
const proved = state.optimize.candidates.find((c) => c.outcome === 'incumbent')!;
const notProved = state.optimize.candidates.find((c) => c.outcome === 'faster-not-proved')!;
const render = (s: SessionState, c: CandidateRecord) => visibleText(renderToString(h(Evidence, { state: s, candidate: c })));

describe('Evidence line', () => {
  it('builds the full line from facts in state', () => {
    expect(evidenceText(evidenceFor(state, proved))).toBe(
      'Proved against the agreed spec (Lean 4.34.0, Mathlib 5ed2965). Verified to k=6. 1,000 differential inputs. ' +
        '12 of 12 broken copies of the original were caught by these inputs. 4.2× faster than the original (95% CI 3.9–4.6) on the declared distribution.\n' +
        provedSentence(1000),
    );
  });

  it('takes N from THIS candidate\'s model check, not the original\'s or another candidate\'s', () => {
    const s2: SessionState = { ...state, modelChecks: state.modelChecks.map((m) => (m.subject === 'candidate' ? { ...m, inputs: 777 } : m)) };
    expect(evidenceFor(s2, proved).provedNote).toBe(provedSentence(777));
    const s3: SessionState = { ...state, modelChecks: [...state.modelChecks, { subject: 'candidate', candidateId: 99, inputs: 5, disagreements: 0, seed: 1, ms: 1 }] };
    expect(evidenceFor(s3, proved).provedNote).toBe(provedSentence(1000));
  });

  it('says so beside the sentence when the model check found disagreements', () => {
    const s2: SessionState = { ...state, modelChecks: state.modelChecks.map((m) => (m.subject === 'candidate' ? { ...m, disagreements: 3 } : m)) };
    const note = evidenceFor(s2, proved).provedNote!;
    expect(note.startsWith(provedSentence(1000))).toBe(true);
    expect(note).toContain('gave different results on 3 inputs');
  });

  it('never counts undistinguished broken copies as caught: they are shown separately', () => {
    const t = evidenceText(evidenceFor(state, notProved));
    expect(t).toContain('11 of 12 broken copies of the original were caught by these inputs.');
    expect(t).toContain('One broken copy could not be told apart from the original on any input tried; not counted as caught.');
  });

  it('never shows "Proved" without the sentence beneath it', () => {
    const text = render(state, proved);
    expect(text).toMatch(/\bProved\b/);
    expect(text).toContain(provedSentence(1000));
    assertClaimsExact(text);
  });

  it('withholds the Proved label when no model check of this candidate is recorded', () => {
    const s2: SessionState = { ...state, modelChecks: state.modelChecks.filter((m) => m.subject !== 'candidate') };
    const text = render(s2, proved);
    expect(text).not.toMatch(/\bProved\b/);
    expect(text).toContain('Lean proof accepted against the agreed spec');
    expect(text).toContain('Label withheld');
    assertClaimsExact(text);
  });

  it('a not-proved candidate gets no Proved clause and no sentence', () => {
    const e = evidenceFor(state, notProved);
    expect(e.provedNote).toBeNull();
    const text = render(state, notProved);
    expect(text).toContain('Verified to k=6.');
    expect(text).not.toMatch(/\bProved\b/);
    assertClaimsExact(text);
  });

  it('omits clauses whose facts are absent and never substitutes another number', () => {
    const bare: CandidateRecord = { ...proved, tier: null, stages: [], bench: null, speedup: null };
    expect(evidenceFor(state, bare).clauses).toEqual([]);
    const noMutants: CandidateRecord = {
      ...proved,
      stages: proved.stages.map((x) => (x.stage === 'differential' ? { ...x, detail: { stage: 'differential', generated: 1000, compared: 1000, seed: 1 } } : x)),
    };
    expect(evidenceText(evidenceFor(state, noMutants))).not.toContain('broken copies');
    // the old, invented keys are not read
    const legacy: CandidateRecord = {
      ...proved,
      stages: proved.stages.map((x) => (x.stage === 'differential' ? { ...x, detail: { inputs: 1000, mutantsCaught: 12, mutantsTotal: 12 } } : x)),
    };
    const t = evidenceText(evidenceFor(state, legacy));
    expect(t).not.toContain('differential inputs');
    expect(t).not.toContain('broken copies');
  });

  it('has no percent sign other than "95% CI", no scores', () => {
    for (const c of state.optimize.candidates) assertClaimsExact(render(state, c));
  });

  it('never rounds a speedup up: point and lower bound floor, upper bound ceils', () => {
    const c: CandidateRecord = { ...proved, speedup: { ratio: 4.29, lo: 3.99, hi: 4.51, significant: true } };
    expect(evidenceText(evidenceFor(state, c))).toContain('4.2× faster than the original (95% CI 3.9–4.6)');
  });

  it('one rule for "faster": speedup.significant, even when the printed interval is above 1', () => {
    const c: CandidateRecord = { ...proved, speedup: { ratio: 1.5, lo: 1.2, hi: 1.8, significant: false } };
    expect(evidenceText(evidenceFor(state, c))).toContain('Not shown to be faster than the original');
  });

  it('reports a non-significant speedup as such', () => {
    const c: CandidateRecord = { ...proved, speedup: { ratio: 1.08, lo: 0.97, hi: 1.2, significant: false } };
    const t = evidenceText(evidenceFor(state, c));
    expect(t).toContain('Not shown to be faster than the original: 1.0× (95% CI 0.9–1.2)');
    expect(t).not.toContain('faster (');
  });
});

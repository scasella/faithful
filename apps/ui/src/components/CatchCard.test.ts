import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { replay, type CandidateRecord } from '@faithful/session';
import { provedSentence } from '@faithful/core/tiers';
import { CatchCard } from './CatchCard';
import { catchFixture, CAND3_GOAL } from '../fixtures/catch';
import { catchView } from '../lib/catch';
import { visibleText, assertClaimsExact } from '../test/text';

const state = replay(catchFixture.events);
const rejected = state.optimize.candidates.find((c) => c.outcome === 'rejected')!;
const call = state.calls.find((c) => c.id === rejected.callId) ?? null;

function render(candidate: CandidateRecord, extra: Partial<{ openWhy: boolean; modelChecked: number | null }> = {}) {
  return renderToString(h(CatchCard, { candidate, params: ['n'], modelChecked: 'modelChecked' in extra ? extra.modelChecked! : 1000, call, openWhy: extra.openWhy ?? true }));
}

describe('CatchCard', () => {
  it('shows the SMT catch: stage line, both outputs side by side, the reason; not benchmarked, as the server does', () => {
    const html = render(rejected);
    const text = visibleText(html);
    expect(text).toContain('Caught: the candidate differs from the original');
    expect(text).toContain('Z3 found an input up to k=6 where the candidate differs');
    expect(text).toContain('For n = 2 the candidate returns 2, the original returns 1');
    expect(text).toMatch(/Input\s*n = 2/);
    expect(text).toMatch(/Original returns\s*1/);
    expect(text).toMatch(/Candidate 1 returns\s*2/);
    // what Z3 searched (the SMT stage's bounds) and that a sat input is replayed before the rejection
    expect(text).toContain('What Z3 searched');
    expect(text).toMatch(/integers\s*\[-64, 64\]/);
    expect(text).toContain('replayed on both functions in the sandbox');
    // rejected at the SMT stage, before the benchmark: no speedup is invented
    expect(html).not.toContain('<del');
    expect(text).toContain('Not benchmarked: rejected at the SMT stage, before the benchmark.');
    // believability: exact tier label + stage sentence
    expect(text).toContain('Verified to k');
    expect(text).toContain('Z3 searched every input up to the bound k=6');
    // what the model saw is present
    expect(text).toContain('What the model saw');
    assertClaimsExact(text);
  });

  it('strikes through a measured speedup that was given up', () => {
    const measured: CandidateRecord = { ...rejected, speedup: { ratio: 4.38, lo: 4.12, hi: 4.66, significant: true } };
    const html = render(measured);
    expect(html).toMatch(/<del class="was">[\s\S]*4\.3×[\s\S]*<\/del>/);
    expect(html).toMatch(/<del class="ci">[\s\S]*95% CI 4\.1–4\.7[\s\S]*<\/del>/);
  });

  it('derives a neutral reason from the counterexample when Rejection.reason is missing', () => {
    const noReason: CandidateRecord = { ...rejected, rejection: { ...rejected.rejection!, reason: '' } };
    const text = visibleText(render(noReason));
    expect(text).toContain('For n = 2 the candidate returns 2, the original returns 1.');
    expect(text).toContain('Written from the counterexample');
    const v = catchView(noReason, null, 1000)!;
    expect(v.reason).toBe('For (2) the candidate returns 2, the original returns 1.');
  });

  it('says "not proved", never "differs", for a proof failure without a counterexample, and shows the goal', () => {
    const proofFailed: CandidateRecord = {
      ...rejected,
      speedup: null,
      rejection: { stage: 'proof', kind: 'proof-failed', reason: '', goal: CAND3_GOAL, theorem: 'theorem cand_meets_spec : True' },
    };
    const text = visibleText(render(proofFailed));
    expect(text).toContain('Rejected: not proved against the agreed spec');
    expect(text).not.toContain('differs');
    expect(text).toContain('Lean proof against the agreed spec failed');
    expect(text).toContain('⊢');
    expect(text).toContain('Not benchmarked');
    expect(text).toContain('A failed proof is the absence of a proof');
    expect(text).toContain(provedSentence(1000));
    assertClaimsExact(text);
  });

  it('withholds the Proved label when the model-check count is unknown', () => {
    const proofFailed: CandidateRecord = { ...rejected, rejection: { stage: 'proof', kind: 'proof-failed', reason: 'x', goal: '⊢ False' } };
    const text = visibleText(render(proofFailed, { modelChecked: null }));
    expect(text).not.toMatch(/\bProved\b/);
    expect(text).toContain('label withheld');
  });

  it('renders nothing for a candidate that was not rejected', () => {
    const ok = state.optimize.candidates.find((c) => c.outcome === 'incumbent')!;
    expect(render(ok)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import type { BenchSummary, CandidateRecord, SessionEvent } from '@faithful/session';
import { replay } from '@faithful/session';
import { assertClaimsExact } from '../../test/text';
import { CATCH, indexOf, render } from '../prove/testutil';
import { DECLARED_BY_SERVER, DEFAULT_DRAFT, draftReducer, parseThreshold, thresholdWords } from './threshold';
import { acceptBlocker, acceptConsequence, finalReadout, verdictText } from './speed';

const bench = (lo: number, hi: number, median = (lo + hi) / 2): BenchSummary => ({ median, lo, hi, unit: 'ns/pass', trials: 30, distribution: 'd', sizes: [] });

describe('threshold selection state', () => {
  it('defaults to a 10-minute time budget', () => {
    expect(DEFAULT_DRAFT.kind).toBe('time-budget');
    expect(parseThreshold(DEFAULT_DRAFT)).toEqual({ ok: true, threshold: { kind: 'time-budget', minutes: 10 } });
  });

  it('switching kind keeps what was typed in the other fields', () => {
    let d = draftReducer(DEFAULT_DRAFT, { type: 'field', field: 'minutes', value: '25' });
    d = draftReducer(d, { type: 'kind', kind: 'speedup' });
    d = draftReducer(d, { type: 'kind', kind: 'time-budget' });
    expect(parseThreshold(d)).toEqual({ ok: true, threshold: { kind: 'time-budget', minutes: 25 } });
  });

  it('a speedup target needs a target above 1; the distribution is the one the server declares, not typed', () => {
    const d = draftReducer(DEFAULT_DRAFT, { type: 'kind', kind: 'speedup' });
    expect(parseThreshold(d)).toEqual({ ok: true, threshold: { kind: 'speedup', target: 2, distribution: DECLARED_BY_SERVER } });
    expect(parseThreshold(draftReducer(d, { type: 'field', field: 'target', value: '1' })).ok).toBe(false);
    expect(parseThreshold(draftReducer(d, { type: 'field', field: 'target', value: 'x' })).ok).toBe(false);
  });

  it('asymptotic is not available in this build: it cannot be selected and never parses', () => {
    expect(draftReducer(DEFAULT_DRAFT, { type: 'kind', kind: 'asymptotic' })).toEqual(DEFAULT_DRAFT);
    expect(parseThreshold({ ...DEFAULT_DRAFT, kind: 'asymptotic' })).toEqual({ ok: false, error: 'The asymptotic threshold is not available in this build.' });
  });

  it('the screen shows asymptotic disabled with the note, and keys 1 and 2 only', () => {
    const { html, text } = render(CATCH.slice(0, indexOf('optimize.started')), 'prove');
    expect(text).toContain('not available in this build');
    expect(html).toMatch(/value="asymptotic"[^>]*disabled/);
    expect(html).not.toContain('aria-keyshortcuts="3"');
  });

  it('time budget rejects zero and junk; reset returns the default', () => {
    expect(parseThreshold({ ...DEFAULT_DRAFT, minutes: '0' }).ok).toBe(false);
    expect(parseThreshold({ ...DEFAULT_DRAFT, minutes: '' }).ok).toBe(false);
    expect(draftReducer({ ...DEFAULT_DRAFT, kind: 'speedup' }, { type: 'reset' })).toEqual(DEFAULT_DRAFT);
  });

  it('words', () => {
    expect(thresholdWords({ kind: 'speedup', target: 3, distribution: DECLARED_BY_SERVER })).toBe(
      'Target: 3× faster than the original (lower end of the 95% CI), on the declared distribution.',
    );
  });
});

describe('"faster": one rule, Speedup.significant (vs the original)', () => {
  it('significant is faster; not significant is not shown to be faster, whatever the intervals look like', () => {
    expect(verdictText({ bench: bench(14.1, 15.2), speedup: { ratio: 4.2, lo: 3.9, hi: 4.6, significant: true } }).verdict).toBe('faster');
    expect(verdictText({ bench: bench(14.1, 15.2), speedup: { ratio: 1.5, lo: 1.2, hi: 1.8, significant: false } }).verdict).toBe('not-shown');
    expect(verdictText({ bench: bench(14.1, 15.2), speedup: null }).verdict).toBe('no-ratio');
    expect(verdictText({ bench: null, speedup: null }).verdict).toBe('not-benchmarked');
  });
  it('the readout on screen always prints the 95% CI, labels the ratio vs the original, and says "faster" only when significant', () => {
    const decided = (id: number, b: BenchSummary): SessionEvent => ({
      kind: 'candidate.decided',
      candidateId: id,
      outcome: 'not-faster',
      tier: 'tested',
      rejection: null,
      bench: b,
      speedup: { ratio: 1.03, lo: 0.97, hi: 1.08, significant: false },
    });
    const at = indexOf('candidate.proposed', indexOf('candidate.decided'));
    const evs = CATCH.slice(0, at + 5);
    const { text } = render([...evs, decided(2, bench(58, 61.5, 59.9))], 'optimize');
    expect(text).toContain('Not shown to be faster than the original on the declared distribution.');
    expect(text).toContain('speedup vs the original 1.0× (95% CI 0.9–1.1)');
    expect(text).not.toContain('Faster than the original');
    const medians = text.match(/Median [\d.]+ ns\/call \(95% CI [\d.]+–[\d.]+\)/g) ?? [];
    expect(medians.length).toBeGreaterThanOrEqual(1);
    expect(text.match(/Median [\d.]+ ns\/call/g)!.length).toBe(medians.length);
    assertClaimsExact(text);
  });
});

describe('accept at Verified to k', () => {
  const s = replay(CATCH);
  const c3 = s.optimize.candidates.find((c) => c.id === 3)!;
  const c2 = s.optimize.candidates.find((c) => c.id === 2)!;

  it('states the consequence: tier, the proof it replaces, and that delivery marks it', () => {
    const t = acceptConsequence(c3, c2).join(' ');
    expect(t).toContain('Candidate 3 becomes the delivered candidate at Verified to k=6');
    expect(t).toContain('It is not proved against the agreed spec.');
    expect(t).toContain("candidate 2's Lean proof");
    expect(t).toContain('Delivery will mark it');
    expect(t).not.toMatch(/\bProved\b/);
  });
  it('without an incumbent, or with the bound missing, it says so', () => {
    const noK: Pick<CandidateRecord, 'id' | 'stages'> = { id: 9, stages: [] };
    const t = acceptConsequence(noK, null).join(' ');
    expect(t).toContain('Verified to k (bound not recorded)');
    expect(t).not.toContain('replaces');
  });
  it('only a candidate at Verified to k can be accepted; the others say why not', () => {
    expect(acceptBlocker(c3)).toBeNull();
    expect(acceptBlocker({ ...c3, tier: 'tested' })).toMatch(/reached only the Tested tier/);
    const evs = CATCH.map((e) => (e.event.kind === 'candidate.decided' && e.event.candidateId === 3 ? { ...e, event: { ...e.event, tier: 'tested' as const } } : e));
    const { text, html } = render(evs, 'optimize');
    expect(text).toContain('None of them passed the bounded SMT check, so none can be accepted.');
    expect(html).not.toContain('aria-keyshortcuts="a"');
  });

  it('the screen shows one accept action with key a and the consequence', () => {
    const { text, html } = render(CATCH, 'optimize');
    expect(text).toContain('Faster, not proved');
    expect(text).toContain('If you accept');
    expect(text).toContain('Accept candidate 3 without a proof');
    expect((html.match(/aria-keyshortcuts="a"/g) ?? []).length).toBe(1);
  });
});

describe('Optimize screen', () => {
  it('the final readout: tier, speedup with interval, candidates tried, each rejection reason', () => {
    const s = replay(CATCH);
    const r = finalReadout(s, ['n'])!;
    expect(r.stoppedWords).toBe('the threshold was reached');
    expect(r.incumbent?.id).toBe(2);
    expect(r.tried).toBe(3);
    expect(r.rows.find((x) => x.id === 1)!.text).toMatch(/^Rejected: For n = 2 the candidate returns 2/);
    expect(r.rows.find((x) => x.id === 3)!.text).toBe('Faster, not proved. Not accepted.');
    expect(finalReadout(replay(CATCH.slice(0, indexOf('optimize.stopped'))), null)).toBeNull();

    const { text } = render(CATCH, 'optimize');
    expect(text).toContain('Stopped: the threshold was reached.');
    expect(text).toContain('Candidates tried 3');
    expect(text).toContain('4.2× (95% CI 3.9–4.6)');
    expect(text).toContain('Caught: the candidate differs from the original'); // CatchCard for candidate 1
    assertClaimsExact(text);
  });

  it('every candidate has its funnel and "What the model saw"', () => {
    const { html } = render(CATCH, 'optimize');
    expect((html.match(/class="funnel"/g) ?? []).length).toBe(3);
    expect((html.match(/What the model saw/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('a candidate\'s proof attempts each show What the model saw, found by event order (the server lists no call ids)', () => {
    const { text } = render(CATCH, 'optimize');
    expect(text).toContain('candidate 2, proof attempt 1 · call 7');
    expect(text).toContain('candidate 2, proof attempt 2 · call 8');
    expect(text).toContain('candidate 3, proof attempt 3 · call 11');
  });

  it('a server stage summary never prints a bare "Proved"', () => {
    const { html } = render(CATCH, 'optimize');
    expect(html).not.toContain('Proved against the agreed spec in 2 attempts');
    expect(html).toContain('Lean accepted a proof against the agreed spec in 2 attempts');
  });

  it('the baseline names the declared distribution and its sizes, and every ratio is vs the original', () => {
    const { text } = render(CATCH, 'optimize');
    expect(text).toContain('on the declared distribution: n uniform in 5..9 (sizes 9)');
    expect(text).toContain('Speedup vs the original');
  });

  it('while streaming, earlier candidates keep their place and new ones are appended', () => {
    const i = indexOf('candidate.proposed', indexOf('incumbent.changed'));
    const before = render(CATCH.slice(0, i), 'optimize').text;
    const after = render(CATCH.slice(0, i + 1), 'optimize').text;
    const pos = (t: string, needle: string) => t.indexOf(needle);
    expect(pos(before, 'Candidate 2 · round 1')).toBeGreaterThan(-1);
    expect(pos(after, 'Candidate 3 · round 2')).toBeGreaterThan(pos(after, 'Candidate 2 · round 1'));
    // the text before the candidate list does not change when a candidate is appended (apart from the running count)
    const head = (t: string) => t.slice(0, t.indexOf('Candidates · in the order proposed')).replace(/\d+ candidates?/, '#');
    expect(head(after)).toBe(head(before));
  });

  it('a candidate decided "faster, not proved" adds its accept panel below the list, not above it', () => {
    const i = indexOf('candidate.decided', indexOf('incumbent.changed'));
    const before = render(CATCH.slice(0, i), 'optimize').text;
    const after = render(CATCH.slice(0, i + 1), 'optimize').text;
    const head = (t: string) => t.slice(0, t.indexOf('Candidates · in the order proposed')).replace(/\d+ candidates?/, '#');
    expect(head(after)).toBe(head(before));
    expect(after.indexOf('If you accept')).toBeGreaterThan(after.indexOf('Candidate 3 · round 2'));
  });
});

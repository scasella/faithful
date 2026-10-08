/** Agree: the gate (unruled challenges disable Agree, with the exact reason), carve-out persistence, payloads, the modal. */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { SessionEvent, StampedEvent } from '@faithful/session';
import type { Precondition } from '@faithful/translate';
import { Shell } from '../../app/App';
import { ReplayAdapter } from '../../adapters/replay';
import { carveOutsOf } from '../../components/CarveOutBand';
import { catchFixture, SPEC_LEAN } from '../../fixtures/catch';
import { assertClaimsExact, visibleText } from '../../test/text';
import { AGREE_LEAD, AgreeScreen } from './AgreeScreen';
import { agreeGate, agreeView, canRevise, carveRuling, fixOriginal, leanSpan, recordedExamples, rulingWords, specWrong } from './gate';
import { buttonTag, fakeAdapter, isDisabled, renderScreen, storeWith } from './testkit';

const EV = catchFixture.events;
const idx = (kind: SessionEvent['kind'], nth = 0) => EV.map((e, i) => [e, i] as const).filter(([e]) => e.event.kind === kind)[nth]![1];
const upTo = (i: number) => EV.slice(0, i + 1);
const proposal = EV[idx('spec.proposed')]!.event as Extract<SessionEvent, { kind: 'spec.proposed' }>;
const SPEC_HASH = proposal.proposal.validation.ok ? proposal.proposal.validation.hash : '';
const firstRuling = EV[idx('ruling.made')]!.event as Extract<SessionEvent, { kind: 'ruling.made' }>;
const CARVE = (firstRuling.ruling as { carveOut: Precondition }).carveOut;

function withExtra(prefix: StampedEvent[], extra: SessionEvent[]): Array<StampedEvent | SessionEvent> {
  return [...prefix, ...extra.map((event, i) => ({ seq: prefix.length + i, t: 0, event }))];
}
const rule = (challengeId: string, r: Record<string, unknown>): SessionEvent => ({ kind: 'ruling.made', ruling: { challengeId, specHash: SPEC_HASH, ...r } as never });
const textOf = (events: Array<StampedEvent | SessionEvent>) => visibleText(renderScreen(AgreeScreen, storeWith(events), fakeAdapter()));

describe('agreeGate', () => {
  it('no proposal', () => {
    const g = agreeGate(storeWith([]).state.value);
    expect(g).toEqual({ ok: false, reason: 'No spec has been proposed yet.', next: 'propose' });
  });

  it('a spec the server did not accept cannot be agreed; the way on is a new proposal', () => {
    const bad: SessionEvent = { kind: 'spec.proposed', proposal: { ...proposal.proposal, validation: { ok: false, errors: ['unknown identifier'] } } };
    const g = agreeGate(storeWith(withExtra(upTo(idx('translate.done')), [bad])).state.value);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.next).toBe('propose');
  });

  it('a spec that merely calls the model is refused: the errors are shown verbatim, with the rule in words', () => {
    const err = 'spec: must not call Model.fib; the spec is an independent statement of what the function should do';
    const bad: SessionEvent = { kind: 'spec.proposed', proposal: { ...proposal.proposal, validation: { ok: false, errors: [err] } } };
    const html = renderScreen(AgreeScreen, storeWith(withExtra(upTo(idx('translate.done')), [bad])), fakeAdapter());
    expect(html).toContain(err);
    expect(visibleText(html)).toContain('The server refuses a spec that merely calls the Lean model of your function');
    expect(isDisabled(buttonTag(html, 'Ask for a new spec'))).toBe(false);
  });

  it('no challenge run yet', () => {
    const g = agreeGate(storeWith(upTo(idx('spec.proposed'))).state.value);
    expect(g).toMatchObject({ ok: false, reason: 'The challenge has not run against the latest spec yet.' });
  });

  it('unruled challenges disable Agree and name every unruled input', () => {
    const s = storeWith(upTo(idx('challenge.run'))).state.value;
    expect(agreeGate(s)).toEqual({
      ok: false,
      reason: 'Agree is unavailable: two challenges are unruled (n = -1; n = -7). Rule each one first.',
      next: 'rule',
    });
    const one = agreeGate(storeWith(upTo(idx('ruling.made'))).state.value);
    expect(!one.ok && one.reason).toBe('Agree is unavailable: one challenge is unruled (n = -7). Rule each one first.');
  });

  it('after the carve-out the server re-ran the challenge with it and found none: Agree is available, pinned to the spec hash', () => {
    expect(agreeGate(storeWith(upTo(idx('challenge.run', 1))).state.value)).toEqual({ ok: true, specHash: SPEC_HASH });
  });

  it('every listed challenge ruled, but the run did not use the current carve-outs: re-run first (as the server says)', () => {
    const s = storeWith(withExtra(upTo(idx('challenge.run')), [rule('ch-1', { ruling: 'function-wrong', then: 'carve-out', carveOut: CARVE }), rule('ch-2', { ruling: 'function-wrong', then: 'carve-out', carveOut: CARVE })])).state.value;
    expect(agreeGate(s)).toEqual({ ok: false, reason: 'The challenge has not run with the current carve-outs yet. Re-run it.', next: 'rerun' });
  });

  it('a run that still found disagreements blocks Agree even when the listed ones are ruled', () => {
    const run: SessionEvent = {
      kind: 'challenge.run',
      run: { id: 3, specHash: SPEC_HASH, inputsTried: 10, inputsCompared: 10, ms: 5, seed: 1, carveOutIds: [CARVE.id], totalDisagreements: 5, disagreements: [{ id: 'ch-9', input: [3], spec: { tag: 'ok', value: 2 }, original: { tag: 'ok', value: 1 }, origin: 'random' }] },
    };
    const s = storeWith(withExtra(upTo(idx('challenge.run', 1)), [run, rule('ch-9', { ruling: 'function-wrong', then: 'carve-out', carveOut: CARVE })])).state.value;
    const g = agreeGate(s);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.reason).toBe('The latest challenge run still found 5 disagreements (4 not listed). Agreeing needs a run with none: carve out, revise the spec, or re-run.');
  });

  it('spec faults at least as many as the compared inputs block Agree, as the server does (none listed, so: a new spec)', () => {
    const runWith = (id: number, inputsCompared: number, specFaults: number): SessionEvent => ({
      kind: 'challenge.run',
      run: {
        id, specHash: SPEC_HASH, inputsTried: 400, inputsCompared, ms: 5, seed: 1, carveOutIds: [CARVE.id], totalDisagreements: 0, disagreements: [],
        excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0, specFaults, generatedBeforeCarveOuts: 400 },
      },
    });
    const gate = (run: SessionEvent) => agreeGate(storeWith(withExtra(upTo(idx('challenge.run', 1)), [run])).state.value);
    const none = gate(runWith(3, 0, 400));
    expect(!none.ok && none.next).toBe('propose');
    expect(!none.ok && none.reason).toMatch(/^Lean could not evaluate the spec on any compared input; 400 inputs produced no value/);
    const most = gate(runWith(4, 10, 390));
    expect(!most.ok && most.reason).toMatch(/^Lean could not evaluate the spec on 390 inputs \(timeout or crash\), at least as many as the 10 it compared/);
    expect(gate(runWith(5, 390, 10))).toEqual({ ok: true, specHash: SPEC_HASH });
  });

  it('"the spec is wrong" means revise first', () => {
    const s = storeWith(withExtra(upTo(idx('challenge.run')), [rule('ch-1', { ruling: 'spec-wrong' }), rule('ch-2', { ruling: 'function-wrong', then: 'carve-out', carveOut: CARVE })])).state.value;
    expect(agreeGate(s)).toEqual({ ok: false, reason: 'You ruled the spec wrong on n = -1. Revise the spec, then rule the new challenge run.', next: 'revise' });
  });

  it('"fix my function" stops the session for this source', () => {
    const s = storeWith(withExtra(upTo(idx('challenge.run')), [rule('ch-1', { ruling: 'function-wrong', then: 'fix-original' }), rule('ch-2', { ruling: 'function-wrong', then: 'fix-original' })])).state.value;
    const g = agreeGate(s);
    expect(!g.ok && g.next).toBe('reopen');
    expect(!g.ok && g.reason).toContain('n = -1; n = -7 and chose to fix it');
  });

  it('a ruling on an older spec does not count for a revision', () => {
    const rev: SessionEvent = { kind: 'spec.proposed', proposal: { ...proposal.proposal, id: 2, kind: 'revision', validation: { ok: true, hash: 'rev-hash' } } };
    const run: SessionEvent = { kind: 'challenge.run', run: { id: 9, specHash: 'rev-hash', inputsTried: 10, inputsCompared: 10, ms: 5, seed: 1, disagreements: [{ id: 'ch-1', input: [-1], spec: { tag: 'ok', value: 0 }, original: { tag: 'ok', value: -1 }, origin: 'boundary' }] } };
    const s = storeWith(withExtra(upTo(idx('challenge.run', 1)), [rev, run])).state.value;
    expect(agreeView(s).unruled).toEqual(['ch-1']);
    expect(agreeGate(s).ok).toBe(false);
  });

  it('already agreed', () => {
    const g = agreeGate(storeWith(upTo(idx('spec.agreed'))).state.value);
    expect(!g.ok && g.reason).toMatch(/^Already agreed/);
  });
});

describe('Agree screen rendering', () => {
  it('the Agree button is disabled while any challenge is unruled, and the reason is printed beside it', () => {
    const html = renderScreen(AgreeScreen, storeWith(upTo(idx('challenge.run'))), fakeAdapter());
    expect(isDisabled(buttonTag(html, 'Agree…'))).toBe(true);
    expect(visibleText(html)).toContain('two challenges are unruled (n = -1; n = -7)');
    // The active row carries the ruling keys; only one row does (duplicate keys would both fire).
    expect((html.match(/aria-keyshortcuts="s"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-keyshortcuts="f"/g) ?? []).length).toBe(1);
  });

  it('once every challenge is ruled, Agree is enabled and the modal lists the consequences with the hash', () => {
    const html = renderScreen(AgreeScreen, storeWith(upTo(idx('challenge.run', 1))), fakeAdapter());
    expect(isDisabled(buttonTag(html, 'Agree…'))).toBe(false);
    const dlg = visibleText(html.match(/<dialog[\s\S]*<\/dialog>/)![0]);
    expect(dlg).toContain(AGREE_LEAD);
    expect(dlg).toContain(`The spec in it has hash ${SPEC_HASH}`);
    expect(dlg).toContain('Changing any of them invalidates the proofs and the incumbent.');
    expect(dlg).toContain(CARVE.words);
    expect(dlg).toContain('n = -1: My function is wrong here; carved out (see Carve-outs).');
    expect((html.match(/<dialog/g) ?? []).length).toBe(1);
  });

  it('after agreeing: the agreement hash is shown, the Agree controls are gone, and there is no dialog', () => {
    const s = storeWith(upTo(idx('spec.agreed')));
    s.go('agree');
    const html = renderScreen(AgreeScreen, s, fakeAdapter());
    const text = visibleText(html);
    expect(text).toContain(`Agreement hash ${s.state.value.agreement!.hash}`);
    expect(html).not.toContain('<dialog');
    expect(() => buttonTag(html, 'Agree…')).toThrow();
  });

  it('shows the invalidation history', () => {
    const text = textOf(withExtra(upTo(idx('spec.agreed')), [{ kind: 'spec.invalidated', reason: 'You changed the carve-out.', at: '2026-10-04T15:00:00.000Z' }]));
    expect(text).toContain('Invalidated agreements');
    expect(text).toContain('You changed the carve-out.');
  });

  it('every proposal and revision has its own "What the model saw"', () => {
    const rev: SessionEvent = { kind: 'spec.proposed', proposal: { ...proposal.proposal, id: 2, kind: 'revision', callId: 1, validation: { ok: true, hash: 'rev-hash' } } };
    const html = renderScreen(AgreeScreen, storeWith(withExtra(upTo(idx('challenge.run')), [rev])), fakeAdapter());
    expect((html.match(/What the model saw/g) ?? []).length).toBe(2);
  });

  it('the examples table lists recorded disagreements with their rulings; agreed inputs are counted, not invented', () => {
    const s = storeWith(upTo(idx('challenge.run', 1))).state.value;
    const ex = recordedExamples(agreeView(s));
    expect(ex.map((e) => e.c.id)).toEqual(['ch-1', 'ch-2']);
    const text = textOf(upTo(idx('challenge.run', 1)));
    expect(text).toContain('No disagreement.');
    expect(text).toMatch(/In run 2, the latest, all 1,000 compared inputs agreed/);
    expect(text).not.toMatch(/the other 1,000/);
  });

  it('every intermediate state of the catch fixture obeys the claim rules on this screen', () => {
    for (let i = idx('spec.proposed'); i < EV.length; i++) assertClaimsExact(textOf(upTo(i)));
  });
});

describe('carve-outs persist', () => {
  it('the band shows the carve-out from the moment it is recorded, on every later event, viewed from any stage', () => {
    const from = idx('ruling.made');
    for (let i = 0; i < EV.length; i++) {
      const store = storeWith(upTo(i));
      if (!store.reachable('agree')) continue;
      store.go('agree');
      const html = renderToString(h(Shell, { store, adapter: new ReplayAdapter(EV, { label: '', fixture: true }) }));
      const band = html.match(/<aside class="carve-band"[\s\S]*?<\/aside>/)?.[0];
      if (i < from) expect(band, `event ${i}`).toBeUndefined();
      else expect(visibleText(band ?? ''), `event ${i}`).toContain(CARVE.words);
    }
  });

  it('survives an invalidation and a revision', () => {
    const rev: SessionEvent = { kind: 'spec.proposed', proposal: { ...proposal.proposal, id: 2, kind: 'revision', validation: { ok: true, hash: 'rev-hash' } } };
    const text = textOf(withExtra(EV.slice(0, idx('proof.started')), [{ kind: 'spec.invalidated', reason: 'Spec revised.', at: 'x' }, rev]));
    expect(text).toContain('Carve-out excluded from every claim, recorded permanently');
    expect(text).toContain(CARVE.words);
  });

  it('is listed once even when several rulings reuse it', () => {
    expect(carveOutsOf(storeWith(upTo(idx('spec.agreed'))).state.value)).toEqual([CARVE]);
  });
});

describe('ruling payloads and words', () => {
  it('builds exactly the RulingInput shapes of the Actions port', () => {
    expect(specWrong()).toEqual({ ruling: 'spec-wrong' });
    expect(fixOriginal()).toEqual({ ruling: 'function-wrong', then: 'fix-original' });
    expect(carveRuling({ param: 0, kind: 'negative' })).toEqual({ ruling: 'function-wrong', then: 'carve-out', carve: { param: 0, kind: 'negative' } });
    expect(carveRuling({ param: -1, kind: 'exact-input' }, 'why')).toEqual({ ruling: 'function-wrong', then: 'carve-out', carve: { param: -1, kind: 'exact-input' }, note: 'why' });
  });

  it('revising is offered only after ruling the spec wrong (the server revises from those rulings)', () => {
    expect(canRevise(storeWith(upTo(idx('challenge.run'))).state.value)).toBe(false);
    expect(canRevise(storeWith(withExtra(upTo(idx('challenge.run')), [rule('ch-1', { ruling: 'spec-wrong' })])).state.value)).toBe(true);
  });

  it('rulings in plain words', () => {
    expect(rulingWords({ challengeId: 'a', specHash: 'h', ruling: 'spec-wrong' })).toBe('The spec is wrong here.');
    expect(rulingWords({ challengeId: 'a', specHash: 'h', ruling: 'function-wrong', then: 'fix-original' })).toBe('My function is wrong here; I will fix it.');
    expect(rulingWords({ challengeId: 'a', specHash: 'h', ruling: 'function-wrong', then: 'carve-out', carveOut: CARVE })).toBe(`My function is wrong here; carved out: ${CARVE.words}`);
  });

  it('maps every English line of the fixture spec to its exact Lean text', () => {
    for (const l of proposal.proposal.lines) {
      const sp = leanSpan(SPEC_LEAN, l.lean)!;
      expect(SPEC_LEAN.slice(sp.start, sp.end)).toBe(l.lean.trim());
    }
    expect(leanSpan(SPEC_LEAN, 'not in there')).toBeNull();
  });
});

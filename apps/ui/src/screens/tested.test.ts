/** The Tested-only path in the UI: the offer on Translate, the funnel and tier on Optimize, the evidence on Deliver. */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { StampedEvent } from '@faithful/session';
import { ReplayAdapter } from '../adapters/replay';
import { ScriptedAdapter } from '../adapters/scripted';
import { Shell } from '../app/App';
import { refusedFixture } from '../fixtures/refused';
import { TESTED_REASON, testedFixture } from '../fixtures/tested';
import { attach, createStore, skippedStages } from '../store';
import { assertClaimsExact, visibleText } from '../test/text';
import { buttonTag, fakeAdapter, isDisabled, renderScreen, storeWith } from './agree/testkit';
import { DeliverScreen } from './deliver/DeliverScreen';
import { deliveryCommands } from './deliver/deliverModel';
import { OptimizeScreen } from './optimize/OptimizeScreen';
import { SPECIALS_WORDS, TranslateScreen, testedBlocker } from './translate/TranslateScreen';

const ro = (events: StampedEvent[]) => new ReplayAdapter(events, { label: '', fixture: true });
const upTo = (kind: string) => testedFixture.events.slice(0, testedFixture.events.findIndex((e) => e.event.kind === kind) + 1);

describe('Translate: a refused function offers the Tested tier only', () => {
  it('shows the action with its key, the threshold and the opt-in special values, and no proof wording', () => {
    const store = storeWith(refusedFixture.events);
    const html = renderScreen(TranslateScreen, store, fakeAdapter());
    const text = visibleText(html);
    const tag = buttonTag(html, 'Optimize with the Tested tier only');
    expect(isDisabled(tag)).toBe(false);
    expect(tag).toContain('aria-keyshortcuts="t"');
    expect(text).toContain('Time budget');
    expect(text).toContain(SPECIALS_WORDS);
    expect(text).toContain('The highest tier any candidate can reach is Tested.');
    expect(text).not.toMatch(/\bProved\b|Verified to/);
    assertClaimsExact(text);
  });

  it('is disabled once started, and says what the inputs are generated from', () => {
    const store = storeWith(upTo('tested.started'));
    expect(testedBlocker(store.state.value)).toMatch(/has started/);
    const html = renderScreen(TranslateScreen, store, fakeAdapter());
    expect(isDisabled(buttonTag(html, 'Optimize with the Tested tier only'))).toBe(true);
    expect(visibleText(html)).toContain('Inputs are generated from average(xs: array of number)');
  });

  it('is not offered for a function inside the subset', () => {
    expect(testedBlocker({ ...storeWith(refusedFixture.events).state.value, translation: null })).not.toBeNull();
  });
});

describe('What ran as the original (tested.started.original / included)', () => {
  const withIncluded = testedFixture.events.map((e) =>
    e.event.kind === 'tested.started' ? { ...e, event: { ...e.event, original: 'extracted' as const, included: ['WEIGHTS', 'scale'], caveats: ['other code in this file (line 9) can change WEIGHTS; that code did not run, so the comparison saw only the starting value of WEIGHTS'] } } : e,
  );
  it('the full Optimize screen names the declarations the extracted original ran with', () => {
    const text = visibleText(renderScreen(OptimizeScreen, storeWith(withIncluded), ro(withIncluded)));
    expect(text).toContain('Ran the function together with: WEIGHTS, scale from the same file; the rest of the file (imports and other code) was not loaded.');
    expect(text).toContain('Caveat: other code in this file (line 9) can change WEIGHTS; that code did not run, so the comparison saw only the starting value of WEIGHTS.');
    assertClaimsExact(text);
  });
  it('a recording from before extraction (no field) says nothing about it; a whole-file run says so', () => {
    const old = visibleText(renderScreen(OptimizeScreen, storeWith(testedFixture.events), ro(testedFixture.events)));
    expect(old).not.toContain('Ran the function');
    const whole = testedFixture.events.map((e) => (e.event.kind === 'tested.started' ? { ...e, event: { ...e.event, original: 'file' as const } } : e));
    expect(visibleText(renderScreen(OptimizeScreen, storeWith(whole), ro(whole)))).toContain('Ran the function with its whole file loaded.');
  });
});

describe('Optimize: the funnel and the tier of a Tested-only session', () => {
  const store = storeWith(testedFixture.events);
  const text = visibleText(renderScreen(OptimizeScreen, store, ro(testedFixture.events)));

  it('says why proof and SMT are skipped, with the translator reason, and labels the tier Tested with N', () => {
    expect(text).toContain('Tested tier only');
    expect(text).toContain(TESTED_REASON.replace(/`/g, ''));
    expect(text).toContain('No spec, Lean proof or SMT check exists for it, so those stages are skipped for every candidate.');
    expect(text).toContain('SMT and Proof: skipped (outside the verifiable subset).');
    expect(text).toContain('Tested on 1,000 generated inputs');
    expect(text).toContain('Caught: the candidate differs from the original');
  });

  it('never says Proved or Verified, nor offers acceptance', () => {
    expect(text).not.toMatch(/\bProved\b|Verified to|Accept candidate/);
    assertClaimsExact(text);
  });
});

describe('Deliver: the Tested evidence line', () => {
  it('only facts present: differential inputs, broken copies caught, speedup with CI; verify re-runs the differential only', () => {
    const store = storeWith(testedFixture.events);
    const text = visibleText(renderScreen(DeliverScreen, store, ro(testedFixture.events)));
    expect(text).toContain('Tested tier only: average is outside the verifiable subset (refusal float), so no spec, proof or SMT claim exists for it.');
    expect(text).toContain('1,000 differential inputs.');
    expect(text).toContain('9 of 10 broken copies of the original were caught by these inputs.');
    expect(text).toMatch(/2\.3× faster than the original \(95% CI 2\.3–2\.5\)/);
    expect(text).toContain('There is no proof or SMT claim to re-check.');
    expect(text).not.toMatch(/\bProved\b|Verified to|Lean on the proof file/);
    assertClaimsExact(text);
    expect(deliveryCommands(store.state.value.delivery!, true, true).map((c) => c.cmd)).toEqual(['faithful verify .faithful/average', 'git apply .faithful/average/patch.diff']);
  });
});

describe('Stages of a Tested-only session', () => {
  it('Agree and Prove are skipped, not reachable, and moving back goes from Optimize to Translate', () => {
    const store = storeWith(testedFixture.events);
    expect(skippedStages(store.state.value)).toEqual(['agree', 'prove']);
    expect(store.reachable('agree')).toBe(false);
    expect(store.reachable('prove')).toBe(false);
    store.go('optimize');
    store.move(-1);
    expect(store.shown.value).toBe('translate');
    const html = renderToString(h(Shell, { store, adapter: ro(testedFixture.events) }));
    expect(html).toContain('not part of this session');
  });

  it('can be driven: open, optimize with the Tested tier only, deliver', async () => {
    const store = createStore();
    const adapter = new ScriptedAdapter(testedFixture.events, { label: 'tested', stepMs: 0 });
    attach(store, adapter);
    const [file] = await adapter.listFiles();
    await adapter.openFunction(file!.path, file!.functions[0]!.name);
    expect(store.state.value.translation?.ok).toBe(false);
    await adapter.startTestedOnly({ kind: 'time-budget', minutes: 3 }, { specials: true });
    await adapter.idle();
    const s = store.state.value;
    expect(s.tested?.specials).toBe(true);
    expect(s.optimize.threshold).toEqual({ kind: 'time-budget', minutes: 3 });
    expect(s.stage).toBe('optimize');
    await adapter.deliver();
    expect(store.state.value.stage).toBe('deliver');
  });
});

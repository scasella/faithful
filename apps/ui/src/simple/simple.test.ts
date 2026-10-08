/**
 * The Simple view over the fixtures, at the moments that matter: which step is shown, its one primary action, the label
 * with its Proved sentence, the carve-outs beside every label they limit, and the claim vocabulary on every screen.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { SessionEvent, StampedEvent } from '@faithful/session';
import { TIER_LABEL, provedSentence } from '@faithful/core/tiers';
import type { Adapter } from '../actions';
import { ReplayAdapter } from '../adapters/replay';
import { FIXTURES, FIXTURE_NOTICE } from '../fixtures';
import { seekTarget } from '../fixtures/seek';
import { AGREE_LEAD } from '../screens/agree/AgreeScreen';
import { agreeView } from '../screens/agree/gate';
import { fakeAdapter, isDisabled } from '../screens/agree/testkit';
import { createStore } from '../store';
import { assertClaimsExact, visibleText } from '../test/text';
import { SimpleShell } from './SimpleApp';

const CATCH = FIXTURES.catch!.events;
const CARVE_WORDS = 'inputs where n is negative are excluded from everything proved below';

function upTo(events: StampedEvent[], at: string | null): StampedEvent[] {
  return at === null ? events : events.slice(0, seekTarget(events, at)!);
}

/** Render the Simple view over `events`; live-looking adapter by default (controls enabled), or a replay. */
function view(events: Array<StampedEvent | SessionEvent>, opts: { replay?: boolean; fixtureTitle?: string } = {}) {
  const store = createStore();
  store.reset(events);
  const adapter: Adapter = opts.replay ? new ReplayAdapter(events as StampedEvent[], { label: 't', fixture: true }) : fakeAdapter();
  const html = renderToString(h(SimpleShell, { store, adapter, fixtureTitle: opts.fixtureTitle, onFull: () => undefined }));
  const text = visibleText(html);
  assertClaimsExact(text);
  const h1 = visibleText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '').trim();
  const h1s = (html.match(/<h1\b/g) ?? []).length;
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ tag: m[1]!, text: visibleText(m[2]!).trim() }));
  const primary = buttons.filter((b) => /class="s-btn primary"/.test(b.tag));
  return { html, text, h1, h1s, buttons, primary };
}

describe('Simple view: one step per screen', () => {
  it('Pick: the question, one search field, the paste disclosure; a header with progress and "Full view"', () => {
    const v = view([]);
    expect(v.h1).toBe('Which function should get faster?');
    expect(v.h1s).toBe(1);
    expect(v.html).toContain('id="s-q"');
    expect(v.text).toContain('or paste a function');
    expect(v.text).toContain('faithful');
    expect(v.text).toContain('Step 1 of 6 · Pick');
    expect(v.buttons.some((b) => b.text === 'Full view')).toBe(true);
    // no keyboard-shortcut chips, no stepper
    expect(v.html).not.toContain('<kbd');
    expect(v.html).not.toContain('stepper');
  });

  it('a fixture always carries its banner', () => {
    expect(view(upTo(CATCH, 'challenge.run'), { replay: true, fixtureTitle: 'x' }).text).toContain(FIXTURE_NOTICE);
  });

  it('Translate, refused: the reason verbatim, "Continue on the Tested tier only" (primary) and "Pick another function"', () => {
    const evs = FIXTURES.refused!.events;
    const v = view(evs);
    const done = evs.find((e) => e.event.kind === 'translate.done')!.event as Extract<SessionEvent, { kind: 'translate.done' }>;
    if (done.result.ok) throw new Error('fixture');
    expect(v.text).toContain('Step 2 of 4 · Translate');
    expect(v.h1).toContain('only tested');
    expect(v.text).toContain(done.result.refusal.reason.replace(/`/g, '').slice(0, 30));
    expect(v.primary.map((b) => b.text)).toEqual([`Continue on the ${TIER_LABEL.tested} tier only`]);
    expect(v.buttons.some((b) => b.text === 'Pick another function')).toBe(true);
    expect(v.text).toContain('Time budget: 10 minutes.');
  });

  it('Agree, before a proposal: one button "Propose a spec"', () => {
    const v = view(upTo(CATCH, 'translate.done'));
    expect(v.text).toContain('Step 3 of 6 · Agree');
    expect(v.primary.map((b) => b.text)).toEqual(['Propose a spec']);
    expect(isDisabled(`<button${v.primary[0]!.tag}>`)).toBe(false);
  });

  it('Agree, a disagreement: ONE at a time, input / spec / function, and the three answers', () => {
    const v = view(upTo(CATCH, 'challenge.run'));
    expect(v.h1).toBe('Who is right on this input?');
    expect(v.text).toContain('Disagreement 1 of 2');
    expect(v.text).toContain('n = -1');
    expect(v.text).toContain('The spec says');
    expect(v.text).toContain('Your function returns');
    expect((v.html.match(/class="s-cx"/g) ?? []).length).toBe(1);
    const names = v.buttons.map((b) => b.text);
    for (const b of ['The spec is wrong', 'Carve these inputs out', "My function is wrong — I'll fix it"]) expect(names).toContain(b);
    expect(v.primary).toEqual([]); // three equal answers, no default
  });

  it('Agree, ready: AGREE_LEAD, the spec lines, preconditions, carve-out, coverage line, rulings, one "Agree"', () => {
    const v = view(upTo(CATCH, 'challenge.run:2'));
    expect(v.h1).toBe('Agree to this spec?');
    expect(v.text).toContain(AGREE_LEAD);
    expect(v.text).toContain('The 0th Fibonacci number is 0.');
    expect(v.text).toContain(CARVE_WORDS);
    expect(v.text).toContain('carve-outs exclude');
    expect(v.text).toContain('My function is wrong here; carved out (see Carve-outs).');
    expect(v.primary.map((b) => b.text)).toEqual(['Agree']);
  });

  it('Agree: the coverage warning when the carve-outs exclude at least half of the generated inputs', () => {
    const evs = upTo(CATCH, 'challenge.run:2').map((e, i, all) =>
      i === all.length - 1 && e.event.kind === 'challenge.run'
        ? { ...e, event: { ...e.event, run: { ...e.event.run, excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 600, generatedBeforeCarveOuts: 1000, specFaults: 3 } } } }
        : e,
    );
    const v = view(evs);
    expect(v.text).toContain('the carve-outs exclude 600 of 1,000 generated inputs');
    expect(v.text).toContain('The carve-outs exclude at least half of the generated inputs');
    expect(v.text).toContain('Three inputs not compared: Lean produced no value for the spec on them.');
  });

  it('Prove: one "Prove it" with the full screen\'s default budget; the carve-out it will not cover', () => {
    const v = view(upTo(CATCH, 'spec.agreed'));
    expect(v.text).toContain('Step 4 of 6 · Prove');
    expect(v.primary.map((b) => b.text)).toEqual(['Prove it']);
    expect(v.text).toContain('at most 10 attempts and 12 minutes');
    expect(v.text).toContain(CARVE_WORDS);
  });

  it('Prove, running: "Attempt n of N" and the elapsed minutes; nothing claimed', () => {
    const v = view(upTo(CATCH, 'proof.attempt'), { replay: true });
    expect(v.h1).toBe('Proving fib');
    expect(v.text).toMatch(/Attempt 2 of \d+/);
    expect(v.text).toMatch(/\d\.\d minutes/);
    expect(v.text).not.toMatch(/\bProved\b/);
  });

  it('Prove, not proved: the failure line and the full screen\'s two offers', () => {
    const evs = upTo(CATCH, 'proof.done').map((e) =>
      e.event.kind === 'proof.done' ? { ...e, event: { ...e.event, result: 'not-proved' as const, accepted: null, failureLine: 'Not proved (2 attempts, 1.2 minutes)' } } : e,
    );
    const v = view(evs);
    expect(v.h1).toBe('Not proved');
    expect(v.text).toContain('Not proved (2 attempts, 1.2 minutes)');
    expect(v.primary.map((b) => b.text)).toEqual(['Continue without the proof']);
    expect(v.buttons.some((b) => b.text.startsWith('Try again with'))).toBe(true);
  });

  it('Faster, before it starts: the original\'s label WITH its Proved sentence, the carve-out beside it, one button', () => {
    const v = view(upTo(CATCH, 'model.checked'));
    expect(v.text).toContain('Step 5 of 6 · Faster');
    expect(v.text).toContain(TIER_LABEL.proved);
    expect(v.text).toContain(provedSentence(1000));
    expect(v.text).toContain(CARVE_WORDS);
    expect(v.primary.map((b) => b.text)).toEqual(['Find a faster version']);
    expect(v.text).toContain('Time budget: 10 minutes.');
  });

  it('Faster, a Z3 catch: one row per candidate; the rejection expands to the input and both outputs; Stop', () => {
    const v = view(upTo(CATCH, 'candidate.decided'), { replay: true });
    expect(v.h1).toBe('Looking for a faster fib');
    expect(v.text).toContain('No faster candidate yet: the original stands.');
    expect(v.text).toContain('Z3 found an input up to k=6 where the candidate differs');
    const cx = /<details class="s-cx-details">[\s\S]*?<\/details>/.exec(v.html)![0];
    expect(visibleText(cx)).toContain('n = 2');
    expect(visibleText(cx)).toMatch(/Original 1 Candidate 1 2/);
    expect(v.buttons.some((b) => b.text === 'Stop')).toBe(true);
    expect(v.text).toContain(CARVE_WORDS);
  });

  it('Faster, the whole stream: every proved label carries its sentence; speedups with their 95% CI', () => {
    const v = view(upTo(CATCH, 'optimize.stopped').slice(0, -1));
    expect((v.html.match(/class="s-cand /g) ?? []).length).toBe(3);
    expect(v.text).toMatch(/Current best: candidate 2, \d+(\.\d+)?× faster than the original \(95% CI [\d.]+–[\d.]+\)\./);
    expect(v.text).toContain(provedSentence(1000));
  });

  it('Result, before delivery: label + sentence, carve-outs BEFORE the speedup, one "Get the patch"', () => {
    const v = view(upTo(CATCH, 'optimize.stopped'));
    expect(v.text).toContain('Step 6 of 6 · Result');
    expect(v.h1).toBe('Candidate 2 replaces the original');
    expect(v.text).toContain(provedSentence(1000));
    const carve = v.text.indexOf(CARVE_WORDS);
    const speed = v.text.search(/\d+(\.\d+)?× faster/);
    expect(carve).toBeGreaterThan(0);
    expect(speed).toBeGreaterThan(carve);
    expect(v.primary.map((b) => b.text)).toEqual(['Get the patch']);
  });

  it('Result, delivered: files, the verify command with a copy button, the apply command', () => {
    const v = view(CATCH);
    expect(v.text).toContain('Your file src/math/fib.ts was not modified.');
    expect(v.text).toContain('.faithful/fib/patch.diff');
    expect(v.text).toContain('faithful verify .faithful/fib');
    expect(v.text).toContain('git apply .faithful/fib/patch.diff');
    expect(v.buttons.filter((b) => b.text === 'Copy').length).toBe(2);
    expect(v.primary).toEqual([]);
    expect(v.html).not.toContain('<kbd');
  });

  it('Result on the Tested tier only: the Tested label with its N; no proof or SMT claim', () => {
    const v = view(FIXTURES.tested!.events);
    expect(v.text).toContain('Step 4 of 4 · Result');
    expect(v.text).toMatch(new RegExp(`${TIER_LABEL.tested} on 1,000 generated inputs`));
    expect(v.text).not.toMatch(/\bProved\b|Verified to k/);
  });

  it('action errors and failed jobs appear inline, in one sentence under the buttons', () => {
    const store = createStore();
    store.reset([...upTo(CATCH, 'translate.done'), { seq: 99, t: 0, event: { kind: 'job.failed', job: 'spec-proposal', message: 'Codex exited with code 2' } }]);
    store.actionError.value = 'The server refused: busy.';
    const html = renderToString(h(SimpleShell, { store, adapter: fakeAdapter() }));
    const actions = visibleText(/<div class="s-actions">[\s\S]*?<\/div>\s*<\/div>|<div class="s-actions">[\s\S]*$/.exec(html)![0]);
    expect(actions).toContain('Asking the model for a spec, then checking it against the Lean model failed: Codex exited with code 2');
    expect(actions).toContain('The server refused: busy.');
  });

  it('a running job is one quiet line, and backend buttons wait for it', () => {
    const store = createStore();
    store.reset([...upTo(CATCH, 'translate.done'), { seq: 99, t: 0, event: { kind: 'job.started', job: 'spec-proposal' } }]);
    const html = renderToString(h(SimpleShell, { store, adapter: fakeAdapter() }));
    expect(visibleText(html)).toContain('Asking the model for a spec, then checking it against the Lean model…');
    const tag = /<button\b[^>]*class="s-btn primary"[^>]*>/.exec(html)![0];
    expect(isDisabled(tag)).toBe(true);
    expect(tag).toContain('Waiting:');
  });

  it('Tested-only Faster step: a Details line names the declarations the extracted original ran with', () => {
    const T = FIXTURES.tested!.events.map((e) =>
      e.event.kind === 'tested.started' ? { ...e, event: { ...e.event, original: 'extracted' as const, included: ['W'], caveats: ['other code in this file (line 4) can change W; that code did not run, so the comparison saw only the starting value of W'] } } : e,
    );
    const v = view(upTo(T, 'optimize.started'));
    expect(v.text).toContain('What ran as the original');
    expect(v.text).toContain('Ran the function together with: W from the same file; the rest of the file (imports and other code) was not loaded.');
    expect(v.text).toContain('Caveat: other code in this file (line 4) can change W; that code did not run, so the comparison saw only the starting value of W.');
    assertClaimsExact(v.text);
    // older recordings carry no field: no line
    expect(view(upTo(FIXTURES.tested!.events, 'optimize.started')).text).not.toContain('What ran as the original');
  });

  it('Tested-only start that failed before optimizing: the failure in one line, "Try again" and "Pick another function"', () => {
    const T = FIXTURES.tested!.events;
    const evs = [...upTo(T, 'tested.started'), { seq: 99, t: 0, event: { kind: 'job.failed' as const, job: 'tested', message: 'the model call failed: timeout' } }];
    const v = view(evs);
    expect(v.text).toContain('Optimizing on the Tested tier only failed: the model call failed: timeout');
    expect(v.primary.map((b) => b.text)).toEqual(['Try again']);
    expect(v.buttons.some((b) => b.text === 'Pick another function')).toBe(true);
  });

  it('Tested-only start that failed because the original did not load (deterministic): the plain reason, no "Try again", only "Pick another function"', () => {
    const T = FIXTURES.tested!.events;
    const message = 'calibration: the original did not load: line 7, column 1: import declarations are not allowed: the function must be self-contained';
    const v = view([...upTo(T, 'tested.started'), { seq: 99, t: 0, event: { kind: 'job.failed' as const, job: 'tested', message } }]);
    expect(v.text).toContain(
      'average cannot run on its own: its file imports another module (line 7, column 1). The Tested tier runs the function in an isolated sandbox, so it needs a self-contained file.',
    );
    expect(v.buttons.some((b) => b.text === 'Try again')).toBe(false);
    expect(v.primary.map((b) => b.text)).toEqual(['Pick another function']);
    expect(v.text).not.toContain('calibration');
    expect(v.text).not.toContain('import declarations are not allowed');
  });

  it('a job failure after optimizing started: no Stop, the failure in one line and "Pick another function"', () => {
    const evs = [...upTo(CATCH, 'candidate.decided'), { seq: 999, t: 0, event: { kind: 'job.failed' as const, job: 'optimize', message: 'sandbox crashed' } }];
    const v = view(evs);
    expect(v.h1).toBe('The search for a faster fib failed');
    expect(v.text).toContain('Optimizing failed: sandbox crashed');
    expect(v.buttons.some((b) => b.text === 'Stop')).toBe(false);
    expect(v.primary.map((b) => b.text)).toEqual(['Pick another function']);
    expect(v.text).toContain(CARVE_WORDS);
  });

  it('Agree, ready: the spec sentence the agreement records (as well as its lines), the rulings and the spec hash', () => {
    const evs = upTo(CATCH, 'challenge.run:2');
    const store = createStore();
    store.reset(evs);
    const av = agreeView(store.state.value);
    const v = view(evs);
    expect(av.proposal!.lines.length).toBeGreaterThan(0);
    expect(v.text).toContain(av.proposal!.english); // recorded in the Agreement: always shown, lines or not
    expect(v.text).toContain(`The spec in it has hash ${av.specHash}`);
    expect(v.text).toContain('Your rulings');
  });

  it('Result with no kept candidate: no "patch" promised', () => {
    const evs = upTo(CATCH, 'optimize.stopped').filter((e) => e.event.kind !== 'incumbent.changed');
    const v = view(evs);
    expect(v.h1).toBe('The original stands');
    expect(v.primary.map((b) => b.text)).toEqual(['Write the evidence files']);
    expect(v.text).not.toContain('patch');
  });

  it('Result: the carve-outs come before the label, in the compact box (not the full receipt band)', () => {
    const v = view(upTo(CATCH, 'optimize.stopped'));
    expect(v.html).toContain('class="s-carves"');
    expect(v.html.indexOf('class="s-carves"')).toBeLessThan(v.html.indexOf('class="s-result-label"'));
    expect(v.text).not.toContain('READ THIS BEFORE');
  });
});

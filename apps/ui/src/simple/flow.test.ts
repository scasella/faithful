/** The Simple view's step model over the fixtures: which step each moment of a session is. */
import { describe, expect, it } from 'vitest';
import { replay, type SessionEvent, type StampedEvent } from '@faithful/session';
import { FIXTURES } from '../fixtures';
import { seekTarget } from '../fixtures/seek';
import { optimizeFailed, pickMark, progressText, proofKey, screenId, simpleStep, stepList, stillPicking, type StepId } from './flow';

const CATCH = FIXTURES.catch!.events;
const upTo = (events: StampedEvent[], at: string) => events.slice(0, seekTarget(events, at)!);
const stateAt = (events: StampedEvent[], at: string) => replay(upTo(events, at).map((e) => e.event));

describe('simpleStep', () => {
  it('walks the catch fixture: Pick → Translate → Agree → Prove → Faster → Result', () => {
    const at = (k: string) => simpleStep(stateAt(CATCH, k));
    expect(simpleStep(replay([]))).toBe('pick');
    expect(at('session.started')).toBe('translate'); // opened, translation pending
    expect(at('translate.done')).toBe('agree'); // nothing to decide: straight to "Propose a spec"
    expect(at('challenge.run')).toBe('agree');
    expect(at('spec.agreed')).toBe('prove');
    expect(at('proof.attempt')).toBe('prove');
    expect(at('proof.done')).toBe('faster'); // proved: the Faster step shows the label above its button
    expect(at('candidate.decided')).toBe('faster');
    expect(at('optimize.stopped')).toBe('result');
    expect(at('deliver.done')).toBe('result');
  });

  it('a refused function: Translate asks, then Faster and Result on the Tested tier only (four steps)', () => {
    const r = replay(FIXTURES.refused!.events.map((e) => e.event));
    expect(simpleStep(r)).toBe('translate');
    expect(stepList(r)).toEqual(['pick', 'translate', 'faster', 'result']);
    expect(progressText(r, 'translate')).toBe('Step 2 of 4 · Translate');
    const T = FIXTURES.tested!.events;
    expect(simpleStep(stateAt(T, 'tested.started'))).toBe('faster');
    expect(simpleStep(stateAt(T, 'candidate.decided'))).toBe('faster');
    expect(simpleStep(replay(T.map((e) => e.event)))).toBe('result');
  });

  it('a throw site asks first', () => {
    const s = stateAt(CATCH, 'translate.done');
    const t = s.translation!;
    if (!t.ok) throw new Error('fixture');
    expect(simpleStep({ ...s, translation: { ok: true, value: { ...t.value, canThrow: true } } })).toBe('translate');
    expect(simpleStep({ ...s, throwChoice: 'precondition', translation: { ok: true, value: { ...t.value, canThrow: true } } })).toBe('agree');
  });

  it('not proved stays on Prove until the person continues without the proof', () => {
    const evs = upTo(CATCH, 'proof.done').map((e): SessionEvent => (e.event.kind === 'proof.done' ? { ...e.event, result: 'not-proved', accepted: null, failureLine: 'Not proved (2 attempts, 1.2 minutes)' } : e.event));
    const s = replay(evs);
    expect(simpleStep(s)).toBe('prove');
    expect(simpleStep(s, { continueUnproved: true })).toBe('faster');
    expect(proofKey(s)).not.toBeNull();
  });

  it('picking another function overrides the session until a new one starts', () => {
    const evs = upTo(CATCH, 'challenge.run');
    const s = replay(evs.map((e) => e.event));
    const mark = pickMark(evs);
    expect(stillPicking(mark, evs)).toBe(true);
    expect(simpleStep(s, { picking: true })).toBe('pick');
    expect(stillPicking(mark, [...evs, CATCH[evs.length]!])).toBe(true); // more of the old session
    const more = [...evs, { seq: evs.length, t: 0, event: CATCH[0]!.event }];
    expect(stillPicking(mark, more)).toBe(false);
    expect(stillPicking(null, evs)).toBe(false);
    expect(progressText(s, 'pick', true)).toBe('Step 1 · Pick'); // the old session's step count says nothing
  });

  it('a reset of the event list (restarted server) ends picking, shorter or not', () => {
    const evs = upTo(CATCH, 'challenge.run');
    const mark = pickMark(evs);
    // the store rebuilds every StampedEvent on a reset: a new session.started below the old index, then the rest
    const shorter = CATCH.slice(0, 3).map((e) => ({ ...e }));
    expect(stillPicking(mark, shorter)).toBe(false);
    const longer = CATCH.map((e) => ({ ...e }));
    expect(stillPicking(mark, longer)).toBe(false);
  });

  it('a job failure after optimize.started is its own screen, not a running search', () => {
    const evs = upTo(CATCH, 'candidate.decided').map((e) => e.event);
    const s = replay([...evs, { kind: 'job.failed', job: 'optimize', message: 'sandbox crashed' } as SessionEvent]);
    expect(simpleStep(s)).toBe('faster');
    expect(optimizeFailed(s)).toBe(true);
    expect(screenId(s, 'faster')).toBe('faster:failed');
    expect(optimizeFailed(replay(evs))).toBe(false);
  });

  it('screen ids change within a step wherever the buttons are replaced', () => {
    const ids = ['translate.done', 'spec.proposed', 'challenge.run', 'spec.agreed'].map((k) => {
      const s = stateAt(CATCH, k);
      return screenId(s, simpleStep(s));
    });
    expect(ids[0]).toBe('agree:propose');
    expect(new Set(ids).size).toBe(ids.length);
    const done = replay(CATCH.map((e) => e.event));
    expect(screenId(done, 'result')).toBe('result:delivered');
  });

  it('progress text names the step among six', () => {
    const s = stateAt(CATCH, 'challenge.run');
    const all: StepId[] = ['pick', 'translate', 'agree', 'prove', 'faster', 'result'];
    expect(all.map((x) => progressText(s, x))).toEqual([
      'Step 1 of 6 · Pick',
      'Step 2 of 6 · Translate',
      'Step 3 of 6 · Agree',
      'Step 4 of 6 · Prove',
      'Step 5 of 6 · Faster',
      'Step 6 of 6 · Result',
    ]);
  });
});

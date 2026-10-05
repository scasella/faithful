import { describe, expect, it } from 'vitest';
import { agreementHash } from './hash.js';
import { initialState, reduce, replay, unruledChallenges } from './reduce.js';
import type { Agreement, CandidateRecord, SessionEvent } from './types.js';

const tc = { capturedAt: '2026-10-04T00:00:00Z', node: 'v25', platform: 'x', codex: { version: '1', model: 'm', effort: 'low' }, lean: { version: 'L', toolchain: 't', mathlibCommit: 'c' }, z3: null };
const started: SessionEvent = { kind: 'session.started', fn: 'f', file: 'a.ts', source: 'x', sourceHash: 'h', toolchain: tc };
const agreement = (specLean: string): Agreement => {
  const base = { specLean, preconditions: [], carveOuts: [], rulings: [], throwChoice: null };
  return { ...base, specHash: 's', english: 'e', hash: agreementHash(base), at: 't' };
};
const cand: CandidateRecord = { id: 1, round: 1, source: 'c', callId: null, stages: [], rejection: null, tier: null, outcome: 'running', bench: null, speedup: null };

describe('session reducer', () => {
  it('is pure and deterministic over a replay', () => {
    const evs: SessionEvent[] = [started, { kind: 'throw.choice', choice: 'precondition' }, { kind: 'spec.agreed', agreement: agreement('def spec := 1') }];
    expect(replay(evs)).toEqual(replay(evs));
    expect(replay(evs).stage).toBe('prove');
  });
  it('tracks unruled disagreements per spec hash', () => {
    const evs: SessionEvent[] = [
      started,
      { kind: 'challenge.run', run: { id: 1, specHash: 'A', inputsTried: 10, inputsCompared: 9, disagreements: [{ id: 'c1', input: [1], spec: { tag: 'ok', value: 1 }, original: { tag: 'ok', value: 2 }, origin: 'boundary' }], ms: 1, seed: 1 } },
    ];
    expect(unruledChallenges(replay(evs), 'A')).toEqual(['c1']);
    const ruled = [...evs, { kind: 'ruling.made', ruling: { challengeId: 'c1', specHash: 'A', ruling: 'spec-wrong' } } as SessionEvent];
    expect(unruledChallenges(replay(ruled), 'A')).toEqual([]);
    expect(unruledChallenges(replay(ruled), 'B')).toEqual([]);
  });
  it('keeps carve-outs once recorded', () => {
    const co = { id: 'co1', kind: 'carve-out' as const, words: 'x is negative', lean: 'x ≥ 0' };
    const s = replay([started, { kind: 'ruling.made', ruling: { challengeId: 'c1', specHash: 'A', ruling: 'function-wrong', then: 'carve-out', carveOut: co } }]);
    expect(s.carveOuts).toEqual([co]);
  });
  it('invalidating the agreement unpins downstream proofs and the incumbent but keeps history', () => {
    const a = agreement('def spec := 1');
    let s = replay([
      started,
      { kind: 'spec.agreed', agreement: a },
      { kind: 'proof.started', proof: { theoremId: 't', statement: 's', statementWords: 'w', pinnedTo: a.hash, attempts: [], result: 'running', accepted: null, ms: 0 } },
      { kind: 'optimize.started', threshold: { kind: 'time-budget', minutes: 5 }, baseline: null, at: 'now' },
      { kind: 'candidate.proposed', candidate: cand },
      { kind: 'incumbent.changed', candidateId: 1 },
    ]);
    s = reduce(s, { kind: 'spec.invalidated', reason: 'spec edited', at: 'later' });
    expect(s.agreement).toBeNull();
    expect(s.optimize.incumbentId).toBeNull();
    expect(s.proofs[0]!.stoppedBy).toBe('spec-changed');
    expect(s.invalidations).toEqual([{ at: 'later', reason: 'spec edited', previousHash: a.hash }]);
    expect(s.optimize.candidates).toHaveLength(1);
  });
  it('agreement hash covers spec, preconditions, carve-outs and rulings', () => {
    const base = { specLean: 'a', preconditions: [], carveOuts: [], rulings: [], throwChoice: null };
    expect(agreementHash(base)).toBe(agreementHash({ ...base }));
    expect(agreementHash(base)).not.toBe(agreementHash({ ...base, specLean: 'b' }));
    expect(agreementHash(base)).not.toBe(agreementHash({ ...base, carveOuts: [{ id: 'x', kind: 'carve-out', words: 'w', lean: 'l' }] }));
  });
  it('ignores unknown event kinds', () => {
    expect(reduce(initialState(), { kind: 'future.thing' } as never)).toEqual(initialState());
  });
});

import type { Precondition } from '@faithful/translate';
import type { CandidateRecord, ProofView, SessionEvent, SessionState, StageName, StampedEvent } from './types.js';

export function initialState(): SessionState {
  return {
    schema: 1,
    fn: '',
    file: '',
    source: '',
    sourceHash: '',
    toolchain: null,
    stage: 'select',
    translation: null,
    throwChoice: null,
    calls: [],
    proposals: [],
    challengeRuns: [],
    rulings: [],
    carveOuts: [],
    agreement: null,
    invalidations: [],
    proofs: [],
    modelChecks: [],
    optimize: { threshold: null, baseline: null, candidates: [], incumbentId: null, stoppedBy: null, startedAt: null },
    delivery: null,
    job: { running: null, lastError: null },
    stamp: null,
  };
}

/** Challenges that still need a ruling for the current spec: disagreements in the latest run for `specHash` without a ruling. */
export function unruledChallenges(s: SessionState, specHash: string): string[] {
  const runs = s.challengeRuns.filter((r) => r.specHash === specHash);
  const last = runs.at(-1);
  if (!last) return [];
  const ruled = new Set(s.rulings.filter((r) => r.specHash === specHash).map((r) => r.challengeId));
  return last.disagreements.filter((d) => !ruled.has(d.id)).map((d) => d.id);
}

function updateCandidate(s: SessionState, id: number, f: (c: CandidateRecord) => CandidateRecord): SessionState {
  return { ...s, optimize: { ...s.optimize, candidates: s.optimize.candidates.map((c) => (c.id === id ? f(c) : c)) } };
}

function updateProof(s: SessionState, id: string, f: (p: ProofView) => ProofView): SessionState {
  return { ...s, proofs: s.proofs.map((p) => (p.theoremId === id ? f(p) : p)) };
}

function mergeCarveOuts(existing: Precondition[], more: Precondition[]): Precondition[] {
  const ids = new Set(existing.map((c) => c.id));
  return [...existing, ...more.filter((c) => !ids.has(c.id))];
}

/** Pure reducer. Unknown future kinds are ignored so old viewers can replay newer recordings. */
export function reduce(s: SessionState, e: SessionEvent): SessionState {
  switch (e.kind) {
    case 'session.started':
      return { ...initialState(), fn: e.fn, file: e.file, source: e.source, sourceHash: e.sourceHash, toolchain: e.toolchain, stage: 'select' };
    case 'translate.done':
      return { ...s, translation: e.result, stage: 'translate' };
    case 'throw.choice':
      return { ...s, throwChoice: e.choice };
    case 'call.recorded':
      return { ...s, calls: [...s.calls, e.call] };
    case 'spec.proposed':
      return { ...s, proposals: [...s.proposals, e.proposal], stage: 'agree' };
    case 'challenge.run':
      return { ...s, challengeRuns: [...s.challengeRuns, e.run], stage: 'agree' };
    case 'ruling.made': {
      const carve = e.ruling.ruling === 'function-wrong' && e.ruling.then === 'carve-out' && e.ruling.carveOut ? [e.ruling.carveOut] : [];
      return { ...s, rulings: [...s.rulings, e.ruling], carveOuts: mergeCarveOuts(s.carveOuts, carve) };
    }
    case 'spec.agreed':
      return { ...s, agreement: e.agreement, stage: 'prove' };
    case 'spec.invalidated': {
      const prev = s.agreement?.hash ?? '';
      return {
        ...s,
        agreement: null,
        // Everything downstream was pinned to the old hash: it is kept only as history, not as a current claim.
        proofs: s.proofs.map((p) => (p.pinnedTo === prev ? { ...p, result: p.result === 'running' ? 'not-proved' : p.result, stoppedBy: 'spec-changed' } : p)),
        optimize: { ...s.optimize, incumbentId: null, stoppedBy: s.optimize.stoppedBy ?? 'user' },
        invalidations: [...s.invalidations, { at: e.at, reason: e.reason, previousHash: prev }],
        stage: 'agree',
      };
    }
    case 'proof.started':
      return { ...s, proofs: [...s.proofs.filter((p) => p.theoremId !== e.proof.theoremId), e.proof], stage: s.stage === 'optimize' ? 'optimize' : 'prove' };
    case 'proof.attempt':
      return updateProof(s, e.theoremId, (p) => ({ ...p, attempts: [...p.attempts, e.attempt] }));
    case 'proof.done':
      return updateProof(s, e.theoremId, (p) => ({ ...p, result: e.result, accepted: e.accepted, ms: e.ms, failureLine: e.failureLine, stoppedBy: e.stoppedBy }));
    case 'model.checked':
      return { ...s, modelChecks: [...s.modelChecks, e.check] };
    case 'optimize.started':
      return { ...s, stage: 'optimize', optimize: { ...s.optimize, threshold: e.threshold, baseline: e.baseline, startedAt: e.at, stoppedBy: null } };
    case 'candidate.proposed':
      return { ...s, optimize: { ...s.optimize, candidates: [...s.optimize.candidates, e.candidate] } };
    case 'stage.result':
      return updateCandidate(s, e.candidateId, (c) => ({ ...c, stages: [...c.stages.filter((x) => x.stage !== e.result.stage), e.result] }));
    case 'candidate.decided':
      return updateCandidate(s, e.candidateId, (c) => ({ ...c, outcome: e.outcome, tier: e.tier, rejection: e.rejection, bench: e.bench, speedup: e.speedup }));
    case 'incumbent.changed':
      return { ...s, optimize: { ...s.optimize, incumbentId: e.candidateId } };
    case 'optimize.stopped':
      return { ...s, optimize: { ...s.optimize, stoppedBy: e.reason } };
    case 'job.started':
      return { ...s, job: { running: e.job, lastError: null } };
    case 'job.finished':
      return { ...s, job: { ...s.job, running: null } };
    case 'job.failed':
      return { ...s, job: { running: null, lastError: { job: e.job, message: e.message } } };
    case 'deliver.done':
      return { ...s, delivery: { dir: e.dir, files: e.files, at: e.at }, stage: 'deliver' };
    default:
      return s;
  }
}

export function replay(events: Array<SessionEvent | StampedEvent>, upTo?: number): SessionState {
  let s = initialState();
  const n = upTo ?? events.length;
  for (let i = 0; i < n; i++) {
    const ev = events[i]!;
    s = reduce(s, 'event' in ev ? ev.event : ev);
  }
  return s;
}

export function stageOf(s: SessionState): StageName {
  return s.stage;
}

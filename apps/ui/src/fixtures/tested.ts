/**
 * DEVELOPMENT FIXTURE, NOT A RECORDING (see ./common.ts). The refused `average(xs)` continued on the Tested tier only:
 * no spec, no proof, no SMT check. Candidate 1 truncates every element, so it is wrong only on non-integer input and the
 * signature generator's doubles catch it; candidate 2 indexes the array directly, agrees on every generated input and is
 * faster, so it is kept at the Tested tier and delivered.
 */
import type { CallRecord, CandidateRecord, SessionEvent, StageResult } from '@faithful/session';
import { FIXTURE_TOOLCHAIN, at, fakeHash, spanOf, timeline, type Fixture } from './common';
import { AVERAGE_SOURCE } from './refused';

export const TESTED_REASON =
  '`sum / xs.length` is a bare division, so its result is not provably an integer. Faithful models `number` as an integer. If integer division is meant, write Math.floor(sum / xs.length).';

export const CANDIDATE_TRUNC = `export function average(xs: number[]): number {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += Math.trunc(xs[i]);
  }
  return sum / xs.length;
}`;

export const CANDIDATE_INDEXED = `export function average(xs: number[]): number {
  const n = xs.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += xs[i];
  }
  return sum / n;
}`;

const SIGNATURE = 'average(xs: array of number)';
const DISTRIBUTION = 'auto: xs: array of n non-integer doubles in [-n, n]';
const OUTSIDE = `outside the verifiable subset: ${TESTED_REASON}`;

let callAt = 4_000;
function call(id: number, round: number, response: string, ms: number, tokens: [number, number], previous?: string): CallRecord {
  callAt += ms + 3_000;
  const prompt = [
    `You are optimizing a TypeScript function for speed. This function is OUTSIDE the subset Faithful can translate to Lean (refusal "float": ${TESTED_REASON}). So there is NO formal specification, NO Lean proof and NO SMT check for it. The original function below IS the reference: your replacement must behave exactly like the original on every input its parameter types allow.`,
    '',
    'FUNCTION: average',
    `PARAMETER TYPES (inputs are generated from these): ${SIGNATURE}`,
    '',
    'ORIGINAL (with its documentation):',
    '```ts',
    AVERAGE_SOURCE.trim(),
    '```',
    ...(previous ? ['', 'YOUR PREVIOUS CANDIDATE:', '```ts', CANDIDATE_TRUNC, '```', previous] : []),
    '',
    `Return JSON with \`source\` (the complete replacement) and \`idea\` (why it is faster). Round ${round}.`,
  ].join('\n');
  return {
    id,
    purpose: 'candidate',
    prompt,
    response,
    model: FIXTURE_TOOLCHAIN.codex.model,
    effort: FIXTURE_TOOLCHAIN.codex.effort,
    ms,
    inputTokens: tokens[0],
    outputTokens: tokens[1],
    error: null,
    startedAt: at(callAt),
  };
}

const REJECTION_1 = {
  stage: 'differential' as const,
  kind: 'counterexample' as const,
  reason: 'the candidate returns a different result for ([0.5, 1.5])',
  counterexample: { input: [[0.5, 1.5]], original: { tag: 'ok' as const, value: 1 }, candidate: { tag: 'ok' as const, value: 0.5 }, source: 'differential' as const },
};

const calls = {
  c1: call(1, 1, JSON.stringify({ source: CANDIDATE_TRUNC, idea: 'Index the array instead of iterating.' }), 18_400, [19_204, 233]),
  c2: call(2, 2, JSON.stringify({ source: CANDIDATE_INDEXED, idea: 'Cache the length and index directly; same additions in the same order.' }), 17_900, [19_655, 241], `Rejected at the differential stage: ${REJECTION_1.reason}`),
};

function proposed(id: number, round: number, source: string, callId: number): CandidateRecord {
  return { id, round, source, callId, stages: [], rejection: null, tier: null, outcome: 'running', bench: null, speedup: null };
}
function stageEvents(candidateId: number, rs: StageResult[]): Array<[number, SessionEvent]> {
  return rs.map((result) => [Math.max(result.ms, 40), { kind: 'stage.result', candidateId, result }]);
}

const BASELINE = { median: 2_412.6, lo: 2_380.1, hi: 2_455.0, unit: 'ns/pass' as const, trials: 31, distribution: DISTRIBUTION, sizes: [64, 128, 256] };
const BENCH_2 = { median: 1_015.2, lo: 998.7, hi: 1_031.9, unit: 'ns/pass' as const, trials: 31, distribution: DISTRIBUTION, sizes: [64, 128, 256] };
const SPEEDUP_2 = { ratio: 2.38, lo: 2.31, hi: 2.44, significant: true };

const C1_STAGES: StageResult[] = [
  { stage: 'compile', status: 'pass', ms: 212, summary: 'compiles under strict TypeScript; signature matches' },
  { stage: 'purity', status: 'pass', ms: 64, summary: 'pure on a sample: no I/O, clock, randomness or input mutation' },
  { stage: 'differential', status: 'fail', ms: 41, summary: 'differs from the original on 461 of 1000 inputs' },
];
const MUTATION = { caught: 9, total: 10, undistinguished: 1, seed: 11 };
const C2_STAGES: StageResult[] = [
  { stage: 'compile', status: 'pass', ms: 198, summary: 'compiles under strict TypeScript; signature matches' },
  { stage: 'purity', status: 'pass', ms: 59, summary: 'pure on a sample: no I/O, clock, randomness or input mutation' },
  {
    stage: 'differential',
    status: 'pass',
    ms: 1_870,
    summary: '1000 inputs from the signature (566 with non-integer numbers), no difference; 9 of 10 broken copies of the original caught',
    detail: { stage: 'differential', generated: 1000, requested: 1000, skippedSlow: 0, skippedFaults: 0, compared: 1000, seed: 7002, mutation: MUTATION, generator: 'signature', nonIntegerInputs: 566, specialInputs: 0, specials: false },
  },
  { stage: 'smt', status: 'skipped', ms: 0, summary: OUTSIDE, detail: { stage: 'smt-skipped', reason: 'outside-subset', refusalCode: 'float' } },
  { stage: 'proof', status: 'skipped', ms: 0, summary: OUTSIDE, detail: { stage: 'proof-skipped', reason: 'outside-subset', refusalCode: 'float' } },
  { stage: 'benchmark', status: 'pass', ms: 6_140, summary: 'faster than the original: 2.4× (95% CI 2.3–2.4)', detail: { stage: 'benchmark', trials: 31, distribution: DISTRIBUTION, sizes: [64, 128, 256] } },
];

const REFUSAL = { code: 'float' as const, reason: TESTED_REASON, span: spanOf(AVERAGE_SOURCE, 'sum / xs.length') };

export const testedFixture: Fixture = {
  name: 'tested',
  title: 'average(xs): refused, optimized on the Tested tier only',
  fixture: true,
  events: timeline([
    [0, { kind: 'session.started', fn: 'average', file: 'src/stats.ts', source: AVERAGE_SOURCE, sourceHash: fakeHash(AVERAGE_SOURCE), toolchain: FIXTURE_TOOLCHAIN }],
    [212, { kind: 'translate.done', result: { ok: false, refusal: REFUSAL } }],
    [4_100, { kind: 'job.started', job: 'tested' }],
    [30, { kind: 'tested.started', refusal: REFUSAL, signature: SIGNATURE, specials: false, at: at(4_130) }],
    [7_900, { kind: 'optimize.started', threshold: { kind: 'time-budget', minutes: 5 }, baseline: BASELINE, at: at(12_030) }],
    [18_400, { kind: 'call.recorded', call: calls.c1 }],
    [90, { kind: 'candidate.proposed', candidate: proposed(1, 1, CANDIDATE_TRUNC, 1) }],
    ...stageEvents(1, C1_STAGES),
    [40, { kind: 'candidate.decided', candidateId: 1, outcome: 'rejected', tier: null, rejection: REJECTION_1, bench: null, speedup: null }],
    [17_900, { kind: 'call.recorded', call: calls.c2 }],
    [90, { kind: 'candidate.proposed', candidate: proposed(2, 2, CANDIDATE_INDEXED, 2) }],
    ...stageEvents(2, C2_STAGES),
    [40, { kind: 'candidate.decided', candidateId: 2, outcome: 'incumbent', tier: 'tested', rejection: null, bench: BENCH_2, speedup: SPEEDUP_2 }],
    [10, { kind: 'incumbent.changed', candidateId: 2 }],
    [52_000, { kind: 'optimize.stopped', reason: 'no-new-candidate' }],
    [10, { kind: 'job.finished', job: 'tested' }],
    [3_200, { kind: 'job.started', job: 'deliver' }],
    [180, { kind: 'deliver.done', dir: '.faithful/average', files: ['patch.diff', 'average.provenance.json', 'VERIFY.md'], at: at(120_000) }],
    [10, { kind: 'job.finished', job: 'deliver' }],
  ]),
};

/**
 * The Lean proof that an optimization candidate meets the agreed spec (the "proof" stage of the optimizer's funnel).
 *
 * The statement is ours, never the model's:
 *   ∀ args, original_pre args → carve-outs → cand_pre args = true ∧ cand args = Spec.spec args
 * i.e. on every input the user's preconditions admit, the candidate stays inside the model's range (so its model is its
 * JavaScript) and returns what the spec says.
 */
import { translate, type Translation } from '@faithful/translate';
import { checkProof, failureLine, proveTheorem, type ProofRecord, type ReferenceProof } from '@faithful/prover';
import { SPLIT_NOTE_EQ, SPLIT_NOTE_RANGE, candidateGuideText } from './candidateGuide.js';
import type { Rejection, StageResult } from '@faithful/session';
import { renameFunction } from './candidate.js';
import { candidateName, stripRecordDecls } from './optimize.js';
import type { SessionRuntime } from './runtime.js';

export interface CandidateProofResult {
  proved: boolean;
  tier?: 'proved' | 'proved-trusting-compiler';
  rejection: Rejection | null;
}

export interface CandidateProofInput {
  source: string;
  id: number;
  budget?: { maxAttempts: number; minutes: number };
  /** The accepted proof that the ORIGINAL meets the spec, when there is one. */
  reference?: { statement: string; helpers: string; proof: string } | null;
  signal?: AbortSignal;
  done: (r: StageResult) => Promise<StageResult>;
  /** 'single' (one theorem) or 'split' (equality and range proved separately, then combined). Default: `candidateProofMode()`. */
  mode?: CandidateProofMode;
  /** Show the candidate-proof guide. Default: `candidateGuideDefault()`. */
  candidateGuide?: boolean;
  /** Add `jsLengthFacts` hypotheses (default `lengthFactsDefault()`). */
  lengthFacts?: boolean;
  /** Reasoning-effort policy for the attempts (default: the prover's proof policy). */
  effort?: string[];
}

export type CandidateProofMode = 'single' | 'split';

/** `FAITHFUL_CANDIDATE_PROOF=single|split`; default DEFAULT_CANDIDATE_PROOF_MODE. */
export function candidateProofMode(env: NodeJS.ProcessEnv = process.env): CandidateProofMode {
  const v = env.FAITHFUL_CANDIDATE_PROOF;
  return v === 'single' || v === 'split' ? v : DEFAULT_CANDIDATE_PROOF_MODE;
}
export const DEFAULT_CANDIDATE_PROOF_MODE: CandidateProofMode = 'single';

/** The candidate-proof guide is on unless `FAITHFUL_CANDIDATE_GUIDE=0` (default DEFAULT_CANDIDATE_GUIDE). */
export function candidateGuideDefault(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FAITHFUL_CANDIDATE_GUIDE === '0') return false;
  if (env.FAITHFUL_CANDIDATE_GUIDE === '1') return true;
  return DEFAULT_CANDIDATE_GUIDE;
}
export const DEFAULT_CANDIDATE_GUIDE = false;

function leanBody(source: string): string {
  return source.replace(/^import .*$/gm, '').trim();
}

export interface CandidateTheorem {
  theoremName: string;
  /** `∀ binders, hyps → cand_pre = true ∧ cand = spec`. */
  statement: string;
  binders: string;
  /** Hypotheses in order (each `... = true`); the binder names are `names`. */
  hyps: string[];
  names: string[];
  call: string;
  candPre: string;
  candFn: string;
  /** Original model followed by the candidate's model. */
  modelSource: string;
  /** Whether `jsLengthFacts` hypotheses are part of the statement. */
  lengthFacts: boolean;
}

/** The statement and the model text of `candidate_<id>_meets_spec` (null when the candidate has no model, with the reason). */
export function candidateTheorem(t: Translation, ct: Translation, theoremExtra: Array<{ lean: string }>, id: number, o: { lengthFacts?: boolean } = {}): CandidateTheorem {
  const names = t.lean.paramNames ?? t.params.map((p) => p.name);
  const binders = t.lean.paramTypes.map((ty, i) => `(${names[i]} : ${ty})`).join(' ');
  const call = names.join(' ');
  const hyps = [`${t.lean.names.pre} ${call}`.trim(), ...theoremExtra.map((p) => p.lean)].map((h) => `${h} = true`);
  const facts = o.lengthFacts ? jsLengthFacts(t, names) : [];
  hyps.push(...facts);
  const statement = `∀ ${binders}, ${hyps.join(' → ')} → ${ct.lean.names.pre} ${call} = true ∧ ${ct.lean.names.original} ${call} = Spec.spec ${call}`.replace(/\s+/g, ' ');
  const modelSource = `${t.lean.source.trimEnd()}\n\n-- candidate model\n${stripRecordDecls(leanBody(ct.lean.source))}\n`;
  return { theoremName: `candidate_${id}_meets_spec`, statement, binders, hyps, names, call, candPre: ct.lean.names.pre, candFn: ct.lean.names.original, modelSource, lengthFacts: facts.length > 0 };
}

/**
 * Facts every JavaScript argument satisfies (ECMAScript): an array has at most 2^32 - 1 elements, a string at most
 * 2^53 - 1 code units. Optional extra hypotheses of the candidate theorem (docs/PROOFS.md, "Candidate proofs", lever e):
 * they exclude only Lean values that no JavaScript value corresponds to, so "Proved" keeps its meaning for the function.
 */
export function jsLengthFacts(t: Translation, names: string[]): string[] {
  const out: string[] = [];
  const bound = (ty: { k: string }) => (ty.k === 'array' ? '4294967295' : ty.k === 'string' ? '9007199254740991' : null);
  t.params.forEach((p, i) => {
    const b = bound(p.ty);
    if (!b) return;
    out.push(`(${names[i]}.length : Int) ≤ ${b}`);
    if (p.ty.k === 'array') {
      const eb = bound((p.ty as { elem: { k: string } }).elem);
      if (eb) out.push(`(∀ e ∈ ${names[i]}, (e.length : Int) ≤ ${eb})`);
    }
  });
  return out;
}

/** Whether the candidate theorem carries `jsLengthFacts`: `FAITHFUL_CANDIDATE_LENGTH_FACTS=1|0`, default DEFAULT_LENGTH_FACTS. */
export function lengthFactsDefault(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FAITHFUL_CANDIDATE_LENGTH_FACTS === '1') return true;
  if (env.FAITHFUL_CANDIDATE_LENGTH_FACTS === '0') return false;
  return DEFAULT_LENGTH_FACTS;
}
export const DEFAULT_LENGTH_FACTS = false;

/** Translate a candidate under the `<fn>_cand` name. */
export function translateCandidate(t: Translation, source: string) {
  const cname = candidateName(t.fnName);
  return translate(renameFunction(source, t.fnName, cname), cname);
}

const stage = (st: 'proof', status: StageResult['status'], ms: number, summary: string, detail?: Record<string, unknown>): StageResult => ({ stage: st, status, ms, summary, detail });

/** Run the proof stage for one candidate; emits proof.started / proof.attempt / proof.done and the stage result. */
export async function proveCandidate(rt: SessionRuntime, inp: CandidateProofInput): Promise<CandidateProofResult> {
  const { source, id, done } = inp;
  const t = rt.translation!;
  const ag = rt.state.agreement!;
  const t0 = performance.now();
  const ct = translateCandidate(t, source);
  if (!ct.ok) {
    await done(stage('proof', 'skipped', performance.now() - t0, `no Lean model: the candidate is outside the verifiable subset (${ct.refusal.reason})`));
    return { proved: false, rejection: { stage: 'proof', kind: 'proof-failed', reason: `the candidate is outside the verifiable subset, so it cannot be proved: ${ct.refusal.reason}` } };
  }
  const sameRecords = JSON.stringify(ct.lean.records ?? []) === JSON.stringify(t.lean.records ?? []) || !(t.lean.records?.length || ct.lean.records?.length);
  if (!sameRecords) {
    await done(stage('proof', 'skipped', performance.now() - t0, 'no proof attempted: the candidate\'s record types are named differently from the original\'s (a known limitation)'));
    return { proved: false, rejection: null };
  }
  const eff = rt.effectivePreconditions();
  const th = candidateTheorem(t, ct, eff.theoremExtra, id, { lengthFacts: inp.lengthFacts ?? lengthFactsDefault() });
  const budget = inp.budget ?? { maxAttempts: 8, minutes: 12 };
  const mode = inp.mode ?? candidateProofMode();
  const res = mode === 'split'
    ? await proveSplit(rt, th, budget, inp, ag.specLean, ag.hash)
    : await proveSingle(rt, th, budget, inp, ag.specLean, ag.hash);
  const { rec, detailExtra } = res;
  const detail = {
    stage: 'proof',
    theoremId: th.theoremName,
    against: 'spec',
    axioms: res.accepted?.axioms ?? [],
    attempts: res.attempts,
    referenceOffered: !!inp.reference,
    statement: th.statement,
    candidateModel: th.modelSource,
    lengthFacts: th.lengthFacts,
    accepted: res.accepted ? { helpers: res.accepted.helpers, proof: res.accepted.proof } : null,
    ...detailExtra,
  };
  if (res.result !== 'not-proved') {
    await done(stage('proof', 'pass', res.ms, `${res.result === 'proved' ? 'Proved' : 'Proved (trusting the compiler)'} against the agreed spec in ${res.attempts} attempt${res.attempts === 1 ? '' : 's'}`, detail));
    await rt.checkModel('candidate', ct, id, 600); // the N behind this candidate's Proved sentence
    return { proved: true, tier: res.result, rejection: null };
  }
  const last = rec.lastDiagnostics.find((d) => d.severity === 'error');
  await done(stage('proof', 'fail', res.ms, res.failureLine, detail));
  return {
    proved: false,
    rejection: { stage: 'proof', kind: 'proof-failed', reason: `${res.failureLine}: Lean could not prove that the candidate meets the agreed spec${res.which ? ` (${res.which})` : ''}`, goal: last?.goal ?? last?.message, theorem: rec.statement },
  };
}

interface StageOutcome {
  result: 'proved' | 'proved-trusting-compiler' | 'not-proved';
  accepted: { helpers: string; proof: string; axioms: string[] } | null;
  attempts: number;
  ms: number;
  failureLine: string;
  /** The record whose last diagnostics explain a failure. */
  rec: ProofRecord;
  /** Which part failed, in words (split mode). */
  which?: string;
  detailExtra: Record<string, unknown>;
}

/** `candidate_<id>_meets_spec` proved in one piece (the pre-2026-10-05 behaviour). */
async function proveSingle(rt: SessionRuntime, th: CandidateTheorem, budget: { maxAttempts: number; minutes: number }, inp: CandidateProofInput, specLean: string, agHash: string): Promise<StageOutcome> {
  const thm = th.theoremName;
  const guide = inp.candidateGuide ?? candidateGuideDefault();
  const target = { modelSource: th.modelSource, specSource: specLean, theoremName: thm, statement: th.statement, tacticImports: rt.proofImports(), library: await rt.librarySource() };
  await rt.emit({
    kind: 'proof.started',
    proof: { theoremId: thm, statement: th.statement, statementWords: wordsFor(th, MEETS_WORDS), pinnedTo: agHash, attempts: [], result: 'running', accepted: null, ms: 0, budget: { maxAttempts: budget.maxAttempts, minutes: budget.minutes } },
  });
  const reference: ReferenceProof | undefined = inp.reference ? { description: 'the proof that the ORIGINAL meets the same spec', ...inp.reference } : undefined;
  const rec = await runProofWithEvents(rt, thm, target, { maxAttempts: budget.maxAttempts, budgetMs: budget.minutes * 60_000, reference, signal: inp.signal, guideExtra: guide ? candidateGuideText('whole', th) : undefined, effort: inp.effort });
  return {
    result: rec.result,
    accepted: rec.accepted ? { helpers: rec.accepted.attempt.helpers, proof: rec.accepted.attempt.proof, axioms: rec.accepted.axioms } : null,
    attempts: rec.attempts.length,
    ms: rec.ms,
    failureLine: failureLine(rec),
    rec,
    detailExtra: { mode: 'single' },
  };
}

const MEETS_WORDS = 'For every input that satisfies the original\'s preconditions, the optimized function stays inside the model\'s range and returns exactly what the agreed spec says.';
const EQUALS_WORDS = 'For every input that satisfies the original\'s preconditions, the optimized function (as modeled) returns exactly what the agreed spec says.';
/** Statement words, with the JavaScript length facts named when the statement carries them. */
export function wordsFor(th: CandidateTheorem, base: string): string {
  return th.lengthFacts ? `${base} (Inputs are JavaScript values: every array argument has at most 2^32 - 1 elements and every string argument at most 2^53 - 1 code units; the Lean statement states this.)` : base;
}
const RANGE_WORDS = 'For every input that satisfies the original\'s preconditions, the optimized function stays inside the model\'s range: every intermediate number within ±2^53, every index in bounds, no division by zero (so its Lean model is its JavaScript).';

/** The checked proof of the original, as Lean text usable as context (`theorem original_meets_spec ...`). */
export function originalProofContext(ref: { statement: string; helpers: string; proof: string } | null | undefined): string {
  if (!ref) return '';
  return [ref.helpers.trim(), theoremText('original_meets_spec', ref.statement, ref.proof)].filter(Boolean).join('\n\n');
}

/** `theorem name : statement :=\n proof` as text. */
function theoremText(name: string, statement: string, proof: string): string {
  const p = proof.trim();
  return `theorem ${name} : ${statement} :=${p.includes('\n') ? '\n' : ' '}${p}`;
}

/** The mechanical proof of the conjunction from the two parts: `intro` every binder and hypothesis, then `⟨R .., E ..⟩`. */
export function combineProof(th: CandidateTheorem, rangeName: string, equalsName: string): string {
  const hs = th.hyps.map((_, i) => `h_c${i + 1}`);
  const args = [...th.names, ...hs].join(' ');
  return `by\n  intro ${args}\n  exact ⟨${rangeName} ${args}, ${equalsName} ${args}⟩`;
}

/**
 * Split mode: two theorems proved separately, then combined mechanically.
 *   candidate_<id>_equals_spec : ∀ args, hyps → cand args = Spec.spec args
 *   candidate_<id>_range_ok    : ∀ args, hyps → cand_pre args = true
 *   candidate_<id>_meets_spec  : (the unchanged statement) := ⟨range_ok .., equals_spec ..⟩
 * Each part goes through the full checker (vetting, its own statement fingerprint, axioms); the combination is checked by
 * the same checker against the unchanged statement's fingerprint, so what "Proved" means does not change. The original's
 * accepted proof (when there is one) is placed in every file as already-checked context. The parts share the candidate's
 * budget: the equality part may use up to two thirds of the minutes and all but two attempts; the range part gets the rest
 * (it is attempted even when the equality part failed, so the user sees which part is the obstacle).
 */
async function proveSplit(rt: SessionRuntime, th: CandidateTheorem, budget: { maxAttempts: number; minutes: number }, inp: CandidateProofInput, specLean: string, agHash: string): Promise<StageOutcome> {
  const t0 = performance.now();
  const id = th.theoremName.replace(/_meets_spec$/, '');
  const eqName = `${id}_equals_spec`;
  const rgName = `${id}_range_ok`;
  const guide = inp.candidateGuide ?? candidateGuideDefault();
  const head = th.statement.slice(0, th.statement.lastIndexOf(' → ') + 3);
  const eqStmt = `${head}${th.candFn} ${th.call} = Spec.spec ${th.call}`.replace(/\s+/g, ' ');
  const rgStmt = `${head}${th.candPre} ${th.call} = true`.replace(/\s+/g, ' ');
  const origCtx = originalProofContext(inp.reference);
  const lib = await rt.librarySource();
  const base = { modelSource: th.modelSource, specSource: specLean, tacticImports: rt.proofImports(), library: lib };
  const totalMs = budget.minutes * 60_000;
  const eqAttempts = Math.max(1, budget.maxAttempts - 2);
  const started = (name: string, statement: string, words: string, b: { maxAttempts: number; minutes: number }) =>
    rt.emit({ kind: 'proof.started', proof: { theoremId: name, statement, statementWords: words, pinnedTo: agHash, attempts: [], result: 'running', accepted: null, ms: 0, budget: b, parent: th.theoremName } });

  // 1. equality
  const eqBudgetMs = (totalMs * 2) / 3;
  await started(eqName, eqStmt, wordsFor(th, EQUALS_WORDS), { maxAttempts: eqAttempts, minutes: eqBudgetMs / 60_000 });
  const eq = await runProofWithEvents(rt, eqName, { ...base, theoremName: eqName, statement: eqStmt, context: origCtx || undefined }, {
    maxAttempts: eqAttempts, budgetMs: eqBudgetMs, signal: inp.signal, guideExtra: guide ? candidateGuideText('equality', th) : SPLIT_NOTE_EQ, effort: inp.effort,
  });
  // 2. range (with the equality theorem and its helpers as context when it was proved)
  const eqCtx = eq.accepted ? [eq.accepted.attempt.helpers.trim(), theoremText(eqName, eqStmt, eq.accepted.attempt.proof)].filter(Boolean).join('\n\n') : '';
  const rgCtx = [origCtx, eqCtx].filter(Boolean).join('\n\n');
  const rgAttempts = Math.max(1, budget.maxAttempts - eq.attempts.length);
  const rgBudgetMs = Math.max(0, totalMs - (performance.now() - t0));
  let rg: ProofRecord | null = null;
  if (rgBudgetMs > 5_000 && !inp.signal?.aborted) {
    await started(rgName, rgStmt, wordsFor(th, RANGE_WORDS), { maxAttempts: rgAttempts, minutes: rgBudgetMs / 60_000 });
    rg = await runProofWithEvents(rt, rgName, { ...base, theoremName: rgName, statement: rgStmt, context: rgCtx || undefined }, {
      maxAttempts: rgAttempts, budgetMs: rgBudgetMs, signal: inp.signal, guideExtra: guide ? candidateGuideText('range', th) : SPLIT_NOTE_RANGE, effort: inp.effort,
    });
  }
  const attempts = eq.attempts.length + (rg?.attempts.length ?? 0);
  const parts = { mode: 'split', equality: partSummary(eqName, eq), range: rg ? partSummary(rgName, rg) : { theoremId: rgName, result: 'not-attempted' } };
  const failed = (which: string, rec: ProofRecord): StageOutcome => ({
    result: 'not-proved', accepted: null, attempts, ms: performance.now() - t0, rec, which,
    failureLine: `Not proved (${attempts} attempt${attempts === 1 ? '' : 's'}, ${((performance.now() - t0) / 60_000).toFixed(1)} minutes; ${which})`,
    detailExtra: parts,
  });
  if (!eq.accepted || !rg?.accepted) {
    const which = !eq.accepted && !rg?.accepted ? 'neither the equality nor the range part was proved' : !eq.accepted ? 'the range part was proved, the equality part was not' : 'the equality part was proved, the range part was not';
    return failed(which, !eq.accepted ? eq : (rg ?? eq));
  }
  // 3. the mechanical combination, checked like any proof against the unchanged statement
  const helpers = [eqCtx, rg.accepted.attempt.helpers.trim(), theoremText(rgName, rgStmt, rg.accepted.attempt.proof)].filter(Boolean).join('\n\n');
  const proof = combineProof(th, rgName, eqName);
  const target = { ...base, theoremName: th.theoremName, statement: th.statement, context: origCtx || undefined };
  await rt.emit({ kind: 'proof.started', proof: { theoremId: th.theoremName, statement: th.statement, statementWords: wordsFor(th, MEETS_WORDS), pinnedTo: agHash, attempts: [], result: 'running', accepted: null, ms: 0, budget: { maxAttempts: 1, minutes: 3 }, parts: [eqName, rgName] } });
  const c0 = performance.now();
  const check = await checkProof(target, { helpers, proof }, { budgetMs: 180_000 });
  const v = check.verdict;
  await rt.emit({ kind: 'proof.attempt', theoremId: th.theoremName, attempt: { n: 1, callId: null, helpers, proof, verdict: v.status === 'proved' ? v.tier : v.status === 'rejected' ? 'rejected' : 'failed', failureReason: v.status === 'failed' ? v.reason : v.status === 'rejected' ? v.reasons.join('; ') : undefined, diagnostics: check.diagnostics.filter((d) => d.severity === 'error').map((d) => ({ line: d.line, column: d.column, message: d.message, goal: d.goal })), ms: performance.now() - c0 } });
  const combinedOk = v.status === 'proved';
  await rt.emit({ kind: 'proof.done', theoremId: th.theoremName, result: combinedOk ? v.tier : 'not-proved', accepted: combinedOk ? { helpers, proof, source: check.source!, axioms: v.axioms } : null, ms: performance.now() - c0, failureLine: combinedOk ? undefined : 'the combination of the two proved parts did not check (a bug in the combiner, not a proof failure)', stoppedBy: combinedOk ? 'proved' : 'attempts' });
  if (!combinedOk) {
    const rec: ProofRecord = { theorem: th.theoremName, statement: th.statement, result: 'not-proved', attempts: [], ms: performance.now() - c0, accepted: null, lastDiagnostics: check.diagnostics, stoppedBy: 'attempts' };
    return { ...failed('the two parts were proved but their combination did not check', rec), detailExtra: { ...parts, combineFailed: true } };
  }
  return {
    result: v.tier,
    accepted: { helpers, proof, axioms: v.axioms },
    attempts,
    ms: performance.now() - t0,
    failureLine: '',
    rec: rg,
    detailExtra: parts,
  };
}

function partSummary(theoremId: string, r: ProofRecord) {
  return { theoremId, result: r.result, attempts: r.attempts.length, ms: r.ms, stoppedBy: r.stoppedBy };
}

/** `proveTheorem` with every Codex call recorded and every checked attempt emitted as `proof.attempt` (then `proof.done`). */
export async function runProofWithEvents(
  rt: SessionRuntime,
  theoremId: string,
  target: Parameters<typeof proveTheorem>[1],
  o: { maxAttempts: number; budgetMs: number; reference?: ReferenceProof; signal?: AbortSignal; guideExtra?: string; effort?: string[] },
): Promise<ProofRecord> {
  const callIds = new Map<number, number>();
  const pending: Promise<void>[] = [];
  const rec = await proveTheorem(rt.codex, target, {
    maxAttempts: o.maxAttempts,
    budgetMs: o.budgetMs,
    checkBudgetMs: 180_000,
    leanDir: undefined,
    reference: o.reference,
    signal: o.signal,
    effort: o.effort,
    onEvent: (e) => {
      if (e.type === 'codex-done') pending.push(rt.recordCall(e.call).then((cid) => void callIds.set(e.n, cid)));
      if (e.type === 'checked') {
        const v = e.check.verdict;
        pending.push(
          Promise.all(pending.slice()).then(() =>
            rt.emit({
              kind: 'proof.attempt',
              theoremId,
              attempt: {
                n: e.n,
                callId: callIds.get(e.n) ?? null,
                helpers: e.check.attemptText?.helpers ?? '',
                proof: e.check.attemptText?.proof ?? '',
                verdict: v.status === 'proved' ? v.tier : v.status === 'rejected' ? 'rejected' : 'failed',
                failureReason: v.status === 'failed' ? v.reason : v.status === 'rejected' ? v.reasons.join('; ') : undefined,
                diagnostics: e.check.diagnostics.filter((d) => d.severity === 'error').map((d) => ({ line: d.line, column: d.column, message: d.message, goal: d.goal })),
                ms: e.ms,
              },
            }),
          ),
        );
      }
    },
  });
  await Promise.all(pending);
  await rt.emit({
    kind: 'proof.done',
    theoremId,
    result: rec.result,
    accepted: rec.accepted ? { helpers: rec.accepted.attempt.helpers, proof: rec.accepted.attempt.proof, source: rec.accepted.source, axioms: rec.accepted.axioms } : null,
    ms: rec.ms,
    failureLine: rec.result === 'not-proved' ? failureLine(rec) : undefined,
    stoppedBy: rec.stoppedBy,
  });
  return rec;
}

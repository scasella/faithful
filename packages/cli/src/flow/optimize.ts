/**
 * The optimization loop. Each candidate passes a funnel (Compile -> Purity -> Differential -> SMT to k -> Lean proof against the
 * agreed spec -> Benchmark). A candidate becomes the incumbent only if proved AND faster (non-overlapping intervals) than the
 * current incumbent. Faster-but-not-proved is shown as exactly that; it becomes the incumbent only if the user explicitly accepts it
 * at the Verified-to-k tier, and delivery marks that. Stages are timed and recorded as session events.
 */
import { hashText, type Tier } from '@faithful/core';
import { translate, type Outcome, type Translation, type Val } from '@faithful/translate';
import {
  bench,
  compare,
  compileGate,
  generateInputs,
  mutationCheck,
  purityGate,
  tsVsTs,
  type Distribution,
} from '@faithful/engine';
import { evalBatch, proveTheorem, failureLine } from '@faithful/prover';
import type { BenchSummary, CandidateRecord, Rejection, Speedup, StageId, StageResult, Threshold } from '@faithful/session';
import { CANDIDATE_SCHEMA, buildCandidatePrompt, normalizeSource, renameFunction } from './candidate.js';
import { calibrateDistribution, describeDistribution } from './distribution.js';
import { noThrowPrecondition } from './theorem.js';
import type { SessionRuntime } from './runtime.js';

// ───────────── SMT seam ─────────────

export interface SmtStageResult {
  status: 'verified' | 'counterexample' | 'unsupported' | 'inconclusive' | 'timeout' | 'unknown';
  /** The k actually completed (arrays/strings), when any. */
  k?: number;
  detail: Record<string, unknown>;
  counterexample?: { input: Val[]; original: Outcome; candidate: Outcome };
  /** Plain words. */
  note: string;
  ms: number;
}

export interface SmtChecker {
  /** `originalFile` is the whole translation unit the original was translated from. */
  check(original: Translation, originalFile: string, candidateSource: string, fnName: string, o: { budgetMs: number }): Promise<SmtStageResult>;
}

// ───────────── options ─────────────

export interface OptimizeOptions {
  threshold: Threshold;
  /** Stop after this many rounds without a NEW candidate (duplicates of earlier ones count as none). Default 3. */
  noNewRounds?: number;
  maxRounds?: number;
  differentialInputs?: number;
  smtBudgetMs?: number;
  proofBudget?: { maxAttempts: number; minutes: number };
  bench?: { trials?: number; minTrialMs?: number };
  signal?: AbortSignal;
}

const toSummary = (r: { pass: { estimate: number; lo: number; hi: number }; trials: number; sizes: number[]; distribution: string; passMs?: number[] }): BenchSummary => ({
  samples: r.passMs,
  // per-pass milliseconds -> ns for the stored unit
  median: r.pass.estimate * 1e6,
  lo: r.pass.lo * 1e6,
  hi: r.pass.hi * 1e6,
  unit: 'ns/pass',
  trials: r.trials,
  distribution: r.distribution,
  sizes: r.sizes,
});

const toSpeedup = (s: { ratio: { estimate: number; lo: number; hi: number }; verdict: string }): Speedup => ({
  ratio: s.ratio.estimate,
  lo: s.ratio.lo,
  hi: s.ratio.hi,
  significant: s.verdict === 'faster',
});

function stage(stage: StageId, status: StageResult['status'], ms: number, summary: string, detail?: Record<string, unknown>): StageResult {
  return { stage, status, ms, summary, detail };
}

/** Inputs on which the instrumented original returns (ok or throw) within `ms`. */
export async function screenFastInputs(t: Translation, inputs: Val[][], sb: import('@faithful/engine').Sandbox, ms: number): Promise<{ fast: Val[][]; slow: number; excluded: number }> {
  const { INSTRUMENTED_ENTRY, instrumentedSandboxSource } = await import('@faithful/engine');
  const id = `screen:${Math.random().toString(36).slice(2)}`;
  const l = await sb.load(id, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true });
  if (!l.ok) throw new Error(`the original did not load: ${l.error}`);
  try {
    const res = (await sb.callBatch(id, inputs, { perCallMs: ms })).results;
    const fast: Val[][] = [];
    let slow = 0;
    let excluded = 0;
    res.forEach((r, i) => {
      if (r.outcome.tag === 'ok' || r.outcome.tag === 'throw') fast.push(inputs[i]!);
      else if (r.outcome.tag === 'fault') slow++;
      else excluded++;
    });
    return { fast, slow, excluded };
  } finally {
    await sb.unload(id);
  }
}

export function candidateName(fn: string): string {
  return `${fn}_cand`;
}

/** Strip the structure/instance blocks a second model would redefine (identical record shapes share names). */
export function stripRecordDecls(body: string): string {
  return body
    .split('\n')
    .reduce<{ out: string[]; skipping: boolean }>(
      (acc, line) => {
        if (/^structure Rec\d+ where/.test(line)) return { out: acc.out, skipping: true };
        if (acc.skipping) return line.trim() === '' ? { out: acc.out, skipping: false } : acc;
        if (/^instance : Lean\.ToJson Rec\d+/.test(line)) return acc;
        acc.out.push(line);
        return acc;
      },
      { out: [], skipping: false },
    )
    .out.join('\n');
}

function leanBody(source: string): string {
  return source.replace(/^import .*$/gm, '').trim();
}

export class Optimizer {
  private rt: SessionRuntime;
  private opts: OptimizeOptions;
  private seen = new Set<string>();
  private origTranslation: Translation;
  private dist!: Distribution;
  private candId = 0;
  private baselineSummary: BenchSummary | null = null;
  private incumbentSource: string;
  private incumbentTiming = '';
  private previous: { source: string; rejection: Rejection } | null = null;
  private t0 = performance.now();
  private originalProofRef: { statement: string; helpers: string; proof: string } | null = null;

  constructor(rt: SessionRuntime, opts: OptimizeOptions) {
    this.rt = rt;
    this.opts = opts;
    const t = rt.translation;
    if (!t) throw new Error('refused functions have no optimization loop; only the Tested tier is available');
    this.origTranslation = t;
    this.incumbentSource = t.source.text;
    const pv = rt.state.proofs.find((p) => p.theoremId === 'original_meets_spec');
    if (pv?.accepted) this.originalProofRef = { statement: pv.statement, helpers: pv.accepted.helpers, proof: pv.accepted.proof };
  }

  private elapsedMin(): number {
    return (performance.now() - this.t0) / 60_000;
  }

  /** Run until the threshold, the budget, or no new candidates; returns why it stopped. */
  async run(): Promise<NonNullable<ReturnType<() => import('@faithful/session').OptimizeState['stoppedBy']>>> {
    const rt = this.rt;
    const t = this.origTranslation;
    const ag = rt.state.agreement;
    if (!ag) throw new Error('agree to a spec first');
    const sb = await rt.getSandbox();
    const eff = rt.effectivePreconditions();
    const cal = await calibrateDistribution(t, eff.carveOuts, sb);
    this.dist = cal.distribution;
    const trials = this.opts.bench?.trials;
    const base = await bench(t.plainTs ?? t.source.text, t.fnName, this.dist, { sandbox: sb, trials, minTrialMs: this.opts.bench?.minTrialMs });
    this.baselineSummary = toSummary(base);
    this.incumbentTiming = `${(base.pass.estimate).toFixed(3)} ms per pass over sizes ${cal.sizes.join(', ')} (95% CI ${base.pass.lo.toFixed(3)}–${base.pass.hi.toFixed(3)} ms); original.`;
    await rt.emit({ kind: 'optimize.started', threshold: this.opts.threshold, baseline: this.baselineSummary, at: new Date().toISOString() });
    this.seen.add(normalizeSource(t.source.text));

    const noNewMax = this.opts.noNewRounds ?? 3;
    const maxRounds = this.opts.maxRounds ?? 12;
    let noNew = 0;
    for (let round = 1; round <= maxRounds; round++) {
      if (this.opts.signal?.aborted) return this.stop('user');
      if (this.opts.threshold.kind === 'time-budget' && this.elapsedMin() >= this.opts.threshold.minutes) return this.stop('budget');
      const prompt = buildCandidatePrompt({
        fn: t.fnName,
        original: t.source.text,
        specEnglish: ag.english,
        specLean: ag.specLean,
        preconditions: ag.preconditions,
        carveOuts: ag.carveOuts,
        incumbent: { source: this.incumbentSource, timing: this.incumbentTiming },
        distribution: this.dist.name,
        previous: this.previous,
        round,
      });
      const call = await rt.codex.ask({ purpose: 'candidate', prompt, schema: CANDIDATE_SCHEMA, signal: this.opts.signal });
      const callId = await rt.recordCall(call);
      const out = call.output as { source?: unknown } | null;
      const source = typeof out?.source === 'string' ? out.source.trim() : '';
      if (call.error || !source) {
        noNew++;
        if (noNew >= noNewMax) return this.stop('no-new-candidate');
        continue;
      }
      const norm = normalizeSource(source);
      if (this.seen.has(norm)) {
        noNew++;
        if (noNew >= noNewMax) return this.stop('no-new-candidate');
        continue;
      }
      this.seen.add(norm);
      noNew = 0;
      const decided = await this.funnel(round, source, callId);
      if (this.thresholdMet()) return this.stop('threshold');
      void decided;
    }
    return this.stop('no-new-candidate');
  }

  private async stop(reason: 'threshold' | 'budget' | 'no-new-candidate' | 'user') {
    await this.rt.emit({ kind: 'optimize.stopped', reason });
    return reason;
  }

  private thresholdMet(): boolean {
    const th = this.opts.threshold;
    const o = this.rt.state.optimize;
    const inc = o.candidates.find((c) => c.id === o.incumbentId);
    if (th.kind === 'speedup' && inc?.speedup) return inc.speedup.lo >= th.target;
    if (th.kind === 'time-budget') return this.elapsedMin() >= th.minutes;
    return false;
  }

  // ───────────── the funnel ─────────────

  private async funnel(round: number, source: string, callId: number): Promise<CandidateRecord> {
    const rt = this.rt;
    const t = this.origTranslation;
    const sb = await rt.getSandbox();
    const id = ++this.candId;
    const cand: CandidateRecord = { id, round, source, callId, stages: [], rejection: null, tier: null, outcome: 'running', bench: null, speedup: null };
    await rt.emit({ kind: 'candidate.proposed', candidate: cand });
    const done = async (r: StageResult) => {
      await rt.emit({ kind: 'stage.result', candidateId: id, result: r });
      return r;
    };
    const reject = async (rej: Rejection, tier: Tier | null = null): Promise<CandidateRecord> => {
      this.previous = { source, rejection: rej };
      await rt.emit({ kind: 'candidate.decided', candidateId: id, outcome: 'rejected', tier, rejection: rej, bench: null, speedup: null });
      return { ...cand, outcome: 'rejected', rejection: rej };
    };

    // 1. compile
    const c = await compileGate({ candidate: source, fnName: t.fnName, original: rt.fileText });
    await done(stage('compile', c.ok ? 'pass' : 'fail', c.ms, c.ok ? 'compiles under strict TypeScript; signature matches' : `${c.diagnostics.filter((d) => d.category === 'error').length} error(s)`));
    if (!c.ok) {
      const d = c.diagnostics.find((x) => x.category === 'error');
      return reject({ stage: 'compile', kind: 'compile-error', reason: d ? `line ${d.line}: ${d.message}` : 'did not compile' });
    }

    // inputs for differential/purity (under the agreed preconditions + carve-outs)
    const eff = rt.effectivePreconditions();
    const nDiff = this.opts.differentialInputs ?? 1000;
    const gen0 = generateInputs({ params: t.params, preconditions: [...t.preconditions, ...eff.carveOuts] }, { n: nDiff, seed: 7000 + id });
    // Inputs the original cannot finish quickly (exponential originals on large n) decide nothing and cost a timeout each:
    // screen them out once, and count them.
    const screen = await screenFastInputs(t, gen0.inputs, sb, 100);
    const gen = { ...gen0, inputs: screen.fast };

    // 2. purity
    const pu = await purityGate(sb, { id: `purity:${id}`, source, fnName: t.fnName, sample: gen.inputs.slice(0, 50) });
    await sb.unload(`purity:${id}`).catch(() => undefined);
    await done(stage('purity', pu.ok ? 'pass' : 'fail', pu.ms, pu.ok ? 'pure on a sample: no I/O, clock, randomness or input mutation' : `impure: ${pu.loadError ?? pu.violations.map((v) => v.kind).join(', ')}`));
    if (!pu.ok) return reject({ stage: 'purity', kind: 'impure', reason: pu.loadError ?? `the candidate ${pu.violations.map((v) => v.kind).join(', ')}` });

    // 3. differential against the original (+ mutation check of the original on the same inputs)
    const td0 = performance.now();
    const rep = await tsVsTs(t, { source, fnName: t.fnName }, gen.inputs, { sandbox: sb, perCallMs: 500 });
    const cr = rep.candidates[0]!;
    const onlyThrowOk = (o: Outcome) => !(eff.theoremExtra.some((p) => p.kind === 'no-throw') && o.tag === 'throw');
    const bad = cr.disagreements.find((d) => onlyThrowOk(d.original));
    if (bad || cr.loadError) {
      await done(stage('differential', 'fail', performance.now() - td0, `differs from the original on ${cr.disagreements.length} of ${cr.compared} inputs`));
      const d = bad ?? cr.disagreements[0];
      return reject({
        stage: 'differential',
        kind: 'counterexample',
        reason: d ? `the candidate returns a different result for ${JSON.stringify(d.args)}` : `the candidate did not load: ${cr.loadError}`,
        counterexample: d ? { input: d.args, original: d.original, candidate: d.candidate, source: 'differential' } : undefined,
      });
    }
    let mut: { caught: number; total: number; undistinguished: number; seed: number } | undefined;
    try {
      const mr = await mutationCheck(t.plainTs ?? t.source.text, t.fnName, gen.inputs.slice(0, 300), { seed: 11, sandbox: sb, instrumentedTs: t.instrumentedTs, perCallMs: 200, secondPassInputs: 200 });
      mut = { caught: mr.caught, total: mr.total, undistinguished: mr.notDistinguished, seed: 11 };
    } catch {
      mut = undefined;
    }
    await done(
      stage('differential', 'pass', performance.now() - td0, `${cr.compared} inputs, no difference${screen.slow ? ` (${screen.slow} inputs skipped: the original takes more than 100 ms)` : ''}${mut ? `; ${mut.caught} of ${mut.total} broken copies of the original caught` : ''}`, {
        stage: 'differential',
        generated: gen0.generated,
        skippedSlow: screen.slow,
        compared: cr.compared,
        seed: 7000 + id,
        mutation: mut,
      }),
    );

    // 4. SMT
    let smtVerified: SmtStageResult | null = null;
    if (!rt.smt) {
      await done(stage('smt', 'skipped', 0, 'the SMT tier is not available in this build'));
    } else {
      const sm = await rt.smt.check(t, rt.fileText, source, t.fnName, { budgetMs: this.opts.smtBudgetMs ?? 60_000 });
      if (sm.status === 'counterexample' && sm.counterexample) {
        await done(stage('smt', 'fail', sm.ms, `Z3 found an input where the candidate differs${sm.k ? ` (arrays up to k=${sm.k})` : ''}`, sm.detail));
        return reject({
          stage: 'smt',
          kind: 'smt-counterexample',
          reason: `a distinguishing input exists: ${JSON.stringify(sm.counterexample.input)}`,
          counterexample: { ...sm.counterexample, source: 'smt' },
        });
      }
      if (sm.status === 'verified') {
        smtVerified = sm;
        await done(stage('smt', 'pass', sm.ms, sm.note, sm.detail));
      } else {
        await done(stage('smt', 'skipped', sm.ms, sm.note, sm.detail));
      }
    }

    // 5. Lean proof against the agreed spec
    const proofRes = await this.proveCandidate(source, id, callId, done);

    // 6. benchmark (any candidate that passed the differential: so a faster-but-wrong one still shows what it claimed)
    const tb0 = performance.now();
    const rep2 = await compare({ source, fnName: t.fnName }, { source: t.plainTs ?? t.source.text, fnName: t.fnName }, this.dist, { sandbox: sb, trials: this.opts.bench?.trials, minTrialMs: this.opts.bench?.minTrialMs });
    const vsOriginal = toSpeedup(rep2.overall);
    let vsIncumbent = vsOriginal;
    const inc = rt.state.optimize.candidates.find((x) => x.id === rt.state.optimize.incumbentId);
    if (inc) {
      const r3 = await compare({ source, fnName: t.fnName }, { source: inc.source, fnName: t.fnName }, this.dist, { sandbox: sb, trials: this.opts.bench?.trials, minTrialMs: this.opts.bench?.minTrialMs });
      vsIncumbent = toSpeedup(r3.overall);
    }
    const benchSummary = toSummary(rep2.candidate);
    await done(stage('benchmark', 'pass', performance.now() - tb0, vsOriginal.significant ? `faster than the original: ${vsOriginal.ratio.toFixed(1)}× (95% CI ${vsOriginal.lo.toFixed(1)}–${vsOriginal.hi.toFixed(1)})` : 'not distinguishable from the original (intervals overlap)', { stage: 'benchmark', trials: rep2.trials, distribution: this.dist.name, sizes: this.dist.sizes }));

    const faster = vsIncumbent.significant;
    const tier: Tier = proofRes.proved ? proofRes.tier! : smtVerified ? 'verified-to-k' : 'tested';
    let outcome: CandidateRecord['outcome'];
    let rejection: Rejection | null = null;
    if (proofRes.proved) {
      outcome = faster ? 'incumbent' : 'not-faster';
    } else if (faster) {
      outcome = 'faster-not-proved';
      rejection = proofRes.rejection;
    } else {
      outcome = 'rejected';
      rejection = proofRes.rejection ?? { stage: 'benchmark', kind: 'not-faster', reason: 'not faster than the incumbent' };
    }
    if (outcome === 'not-faster') rejection = { stage: 'benchmark', kind: 'not-faster', reason: 'proved against the spec, but not faster than the incumbent (intervals overlap)' };
    if (rejection) this.previous = { source, rejection };
    await rt.emit({ kind: 'candidate.decided', candidateId: id, outcome, tier, rejection, bench: benchSummary, speedup: vsOriginal });
    if (outcome === 'incumbent') {
      this.incumbentSource = source;
      this.incumbentTiming = `${rep2.candidate.pass.estimate.toFixed(3)} ms per pass (95% CI ${rep2.candidate.pass.lo.toFixed(3)}–${rep2.candidate.pass.hi.toFixed(3)} ms); ${vsOriginal.ratio.toFixed(1)}× faster than the original.`;
      await rt.emit({ kind: 'incumbent.changed', candidateId: id });
    }
    return { ...cand, outcome, tier, rejection };
  }

  /** The user explicitly accepts a faster-but-not-proved candidate at the Verified-to-k tier. */
  async acceptFasterNotProved(candidateId: number): Promise<void> {
    const c = this.rt.state.optimize.candidates.find((x) => x.id === candidateId);
    if (!c) throw new Error('unknown candidate');
    if (c.outcome !== 'faster-not-proved') throw new Error('only a candidate shown as "faster, not proved" can be accepted');
    if (c.tier !== 'verified-to-k') throw new Error('this candidate has not reached the Verified-to-k tier (the SMT check did not complete), so it cannot be accepted');
    await this.rt.emit({ kind: 'candidate.decided', candidateId, outcome: 'accepted-at-verified', tier: 'verified-to-k', rejection: c.rejection, bench: c.bench, speedup: c.speedup });
    await this.rt.emit({ kind: 'incumbent.changed', candidateId });
    this.incumbentSource = c.source;
  }

  // ───────────── proof of the candidate ─────────────

  private async proveCandidate(
    source: string,
    id: number,
    _callId: number,
    done: (r: StageResult) => Promise<StageResult>,
  ): Promise<{ proved: boolean; tier?: 'proved' | 'proved-trusting-compiler'; rejection: Rejection | null }> {
    const rt = this.rt;
    const t = this.origTranslation;
    const ag = rt.state.agreement!;
    const t0 = performance.now();
    const cname = candidateName(t.fnName);
    const ct = translate(renameFunction(source, t.fnName, cname), cname);
    if (!ct.ok) {
      await done(stage('proof', 'skipped', performance.now() - t0, `no Lean model: the candidate is outside the verifiable subset (${ct.refusal.reason})`));
      return { proved: false, rejection: { stage: 'proof', kind: 'proof-failed', reason: `the candidate is outside the verifiable subset, so it cannot be proved: ${ct.refusal.reason}` } };
    }
    const sameRecords = JSON.stringify(ct.lean.records ?? []) === JSON.stringify(t.lean.records ?? []) || !(t.lean.records?.length || ct.lean.records?.length);
    if (!sameRecords) {
      await done(stage('proof', 'skipped', performance.now() - t0, 'no proof attempted: the candidate\'s record types are named differently from the original\'s (a known limitation)'));
      return { proved: false, rejection: null };
    }
    const names = t.lean.paramNames ?? t.params.map((p) => p.name);
    const binders = t.lean.paramTypes.map((ty, i) => `(${names[i]} : ${ty})`).join(' ');
    const call = names.join(' ');
    const eff = rt.effectivePreconditions();
    const hyps = [`${t.lean.names.pre} ${call}`.trim(), ...eff.theoremExtra.map((p) => p.lean)].map((h) => `${h} = true`);
    const statement = `∀ ${binders}, ${hyps.join(' → ')} → ${ct.lean.names.pre} ${call} = true ∧ ${ct.lean.names.original} ${call} = Spec.spec ${call}`.replace(/\s+/g, ' ');
    const thm = `candidate_${id}_meets_spec`;
    const modelSource = `${t.lean.source.trimEnd()}\n\n-- candidate model\n${stripRecordDecls(leanBody(ct.lean.source))}\n`;
    const target = { modelSource, specSource: ag.specLean, theoremName: thm, statement, tacticImports: rt.proofImports(), library: await rt.librarySource() };
    const budget = this.opts.proofBudget ?? { maxAttempts: 4, minutes: 6 };
    const rec = await proveTheorem(rt.codex, target, {
      maxAttempts: budget.maxAttempts,
      budgetMs: budget.minutes * 60_000,
      checkBudgetMs: 180_000,
      leanDir: undefined,
      reference: this.originalProofRef ? { description: 'the proof that the ORIGINAL meets the same spec', ...this.originalProofRef } : undefined,
      signal: this.opts.signal,
      onEvent: (e) => {
        if (e.type === 'codex-done') void rt.recordCall(e.call);
      },
    });
    const detail = {
      stage: 'proof',
      theoremId: thm,
      against: 'spec',
      axioms: rec.accepted?.axioms ?? [],
      attempts: rec.attempts.length,
      referenceOffered: !!this.originalProofRef,
      statement,
      candidateModel: modelSource,
      accepted: rec.accepted ? { helpers: rec.accepted.attempt.helpers, proof: rec.accepted.attempt.proof } : null,
    };
    if (rec.result !== 'not-proved') {
      await done(stage('proof', 'pass', rec.ms, `${rec.result === 'proved' ? 'Proved' : 'Proved (trusting the compiler)'} against the agreed spec in ${rec.attempts.length} attempt${rec.attempts.length === 1 ? '' : 's'}`, detail));
      await rt.checkModel('candidate', ct, id, 600); // the N behind this candidate's Proved sentence
      return { proved: true, tier: rec.result, rejection: null };
    }
    const last = rec.lastDiagnostics.find((d) => d.severity === 'error');
    await done(stage('proof', 'fail', rec.ms, failureLine(rec), detail));
    return {
      proved: false,
      rejection: { stage: 'proof', kind: 'proof-failed', reason: `${failureLine(rec)}: Lean could not prove that the candidate meets the agreed spec`, goal: last?.goal ?? last?.message, theorem: statement },
    };
  }
}

void hashText;
void evalBatch;
void noThrowPrecondition;
void describeDistribution;

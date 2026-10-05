/**
 * The Tested-only path: optimization for a function the translator REFUSED (docs/TIERS.md "Tested"). There is no Lean
 * model, so there is no spec, no agreement, no Lean proof and no SMT check. The original function itself is the
 * reference.
 *
 * Same loop shape as `Optimizer` (optimize.ts): ask Codex for a candidate (prompt: the original with its JSDoc, the
 * incumbent's timing, the previous candidate's rejection, and the plain statement that no formal spec exists), then the
 * funnel
 *   Compile -> Purity -> Differential against the original on inputs generated from the TypeScript signature
 *   (integers AND non-integer doubles; NaN/Infinity/-0 only on opt-in) + the mutation check of the original's broken
 *   copies -> Benchmark with its 95% CI,
 * with the SMT and proof stages recorded as `skipped` ("outside the verifiable subset: <refusal reason>"). Every candidate
 * that passes the differential is at tier `tested`; it becomes the incumbent only when it is significantly faster than
 * the incumbent (non-overlapping intervals). Delivery (`deliverTested`) states the Tested tier with N and the mutation
 * counts and never a Proved or Verified claim; `verifyTestedOnly` re-runs the differential for `faithful verify`.
 *
 * Values cross as JSON with sentinels for NaN/Infinity/-0/undefined (engine `differential/jsvalues.ts`); the sandbox
 * runs both functions in its `'js'` value domain. Equality: NaN equals NaN, -0 and 0 differ, undefined and null differ.
 */
import { createTwoFilesPatch } from 'diff';
import { hashText, stampFrom, TIER_LABEL, type Tier } from '@faithful/core';
import type { Val } from '@faithful/translate';
import {
  bench,
  buildEvidenceBlock,
  compare,
  compileGate,
  containsNonInteger,
  containsSpecialNumber,
  generateSignatureInputs,
  inferSignature,
  jsVsJs,
  mutationCheck,
  purityGate,
  screenOriginal,
  showJsArgs,
  showJsOutcome,
  signatureWords,
  sizedDistributionWords,
  sizedValue,
  mulberry32,
  type BenchRng,
  type Distribution,
  type FunctionSignature,
  type JsProgram,
  type Sandbox,
} from '@faithful/engine';
import type { BenchSummary, CandidateRecord, Claim, Provenance, Rejection, Speedup, StageId, StageResult, Threshold } from '@faithful/session';
import { isDifferentialDetail } from '@faithful/session';
import { CANDIDATE_SCHEMA, findFunction, normalizeSource } from './candidate.js';
import { extractCandidateFunction } from './deliver.js';
import type { SessionRuntime } from './runtime.js';

/** The equality the Tested-only differential uses, in words (recorded in provenance and VERIFY.md). */
export const TESTED_EQUALITY =
  'same thrown message, or the same returned value compared exactly: numbers by Object.is (NaN equals NaN; -0 and 0 are different; non-integer doubles must be identical), undefined differs from null, records by key set and values';

/** Which inputs decide nothing (recorded in provenance caveats and VERIFY.md). */
export const TESTED_EXCLUSIONS =
  'Inputs on which the original faults are excluded from the comparison and counted, not compared: a call slower than 100 ms, a thrown value that is not a plain Error or a string (for example a RangeError or TypeError instance), or a result that is not plain data';

// ───────────── prompt ─────────────

export interface TestedPromptInput {
  fn: string;
  /** The original function with its JSDoc. */
  original: string;
  refusal: { code: string; reason: string };
  signature: string;
  specials: boolean;
  incumbent: { source: string; timing: string };
  distribution: string;
  previous?: { source: string; rejection: Rejection } | null;
  round: number;
}

export function describeTestedRejection(r: Rejection): string {
  const lines = [`Rejected at the ${r.stage} stage: ${r.reason}`];
  if (r.counterexample) {
    lines.push(`Counterexample input: (${showJsArgs(r.counterexample.input)}); the original ${showJsOutcome(r.counterexample.original)}, the candidate ${showJsOutcome(r.counterexample.candidate)}.`);
  }
  return lines.join('\n');
}

export function buildTestedPrompt(p: TestedPromptInput): string {
  const numbers = p.specials
    ? 'integers (including beyond 2^53), non-integer doubles, and NaN, Infinity, -Infinity and -0'
    : 'integers (including beyond 2^53) and non-integer doubles (NaN, Infinity and -0 are not generated as inputs, but may appear as results)';
  return [
    `You are optimizing a TypeScript function for speed. This function is OUTSIDE the subset Faithful can translate to Lean (refusal "${p.refusal.code}": ${p.refusal.reason}). So there is NO formal specification, NO Lean proof and NO SMT check for it. The original function below IS the reference: your replacement must behave exactly like the original on every input its parameter types allow.`,
    `It is checked by differential testing against the original on generated inputs (numbers: ${numbers}; strings including non-ASCII and astral characters; empty and one-element arrays), by a mutation check, and then benchmarked. A faster function that differs from the original on any input is rejected. Results are compared exactly: ${TESTED_EQUALITY}. A thrown Error must have the same message.`,
    'Floating point: reordering additions, or replacing a division by a multiplication, changes rounding and is a difference. Keep the original\'s order of floating-point operations unless the result is provably identical.',
    '',
    `FUNCTION: ${p.fn}`,
    `PARAMETER TYPES (inputs are generated from these): ${p.signature}`,
    '',
    'ORIGINAL (with its documentation):',
    '```ts',
    p.original.trim(),
    '```',
    '',
    `CURRENT BEST (the incumbent) and its timing on the declared distribution (${p.distribution}): ${p.incumbent.timing}`,
    '```ts',
    p.incumbent.source.trim(),
    '```',
    ...(p.previous ? ['', 'YOUR PREVIOUS CANDIDATE:', '```ts', p.previous.source.trim(), '```', describeTestedRejection(p.previous.rejection), 'Do not repeat this mistake.'] : []),
    '',
    'RULES: keep the exported name, parameter names and types, and return type. Pure code only: no I/O, no randomness, no clock, no globals, no mutation of the arguments. Self-contained: no imports, and do not rely on other declarations of the original file.',
    `Return JSON with \`source\` (the complete replacement) and \`idea\` (why it is faster). Round ${p.round}.`,
  ].join('\n');
}

// ───────────── benchmark distribution from the signature ─────────────

export interface SignatureCalibrated {
  distribution: Distribution;
  sizes: number[];
  note: string;
}

/**
 * The declared distribution for a Tested-only function, calibrated like `calibrateDistribution` (distribution.ts) but
 * from the TypeScript signature instead of a Translation: sizes double until one call of the original takes about
 * `targetMs`, and stop where the original throws or faults.
 */
export async function calibrateSignatureDistribution(sig: FunctionSignature, original: JsProgram, sb: Sandbox, opts: { targetMs?: number; maxSize?: number } = {}): Promise<SignatureCalibrated> {
  const targetMs = opts.targetMs ?? 1;
  const maxSize = opts.maxSize ?? 4096;
  const gen = (size: number, rng: BenchRng): Val[] => sig.params.map((p) => sizedValue(p.ty, size, rng));
  const id = `calib-tested:${Math.random().toString(36).slice(2)}`;
  const loaded = await sb.load(id, original.source, original.fnName, { values: 'js' });
  if (!loaded.ok) throw new Error(`calibration: the original did not load: ${loaded.error}`);
  let best = 1;
  let note = 'sizes chosen by running the original';
  try {
    for (let size = 2; size <= maxSize; size *= 2) {
      const rng = mulberry32(7 + size);
      const sample = Array.from({ length: 6 }, () => gen(size, rng));
      const t0 = performance.now();
      const res = (await sb.callBatch(id, sample, { perCallMs: 5_000 })).results;
      const ms = (performance.now() - t0) / sample.length;
      if (res.some((r) => r.outcome.tag !== 'ok')) {
        note = `sizes stop at ${best}: larger inputs make the original throw or fail`;
        break;
      }
      best = size;
      if (ms >= targetMs) {
        note = `sizes chosen so one call of the original takes about ${targetMs} ms at the largest size`;
        break;
      }
    }
  } finally {
    await sb.unload(id);
  }
  const sizes = [...new Set([Math.max(1, Math.floor(best / 4)), Math.max(1, Math.floor(best / 2)), best])];
  return { distribution: { name: `auto: ${sizedDistributionWords(sig)}`, sizes, gen }, sizes, note };
}

// ───────────── the loop ─────────────

export interface TestedOptions {
  threshold: Threshold;
  noNewRounds?: number;
  maxRounds?: number;
  differentialInputs?: number;
  bench?: { trials?: number; minTrialMs?: number };
  signal?: AbortSignal;
}

const toSummary = (r: { pass: { estimate: number; lo: number; hi: number }; trials: number; sizes: number[]; distribution: string; passMs?: number[] }): BenchSummary => ({
  samples: r.passMs,
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

function stage(id: StageId, status: StageResult['status'], ms: number, summary: string, detail?: Record<string, unknown>): StageResult {
  return { stage: id, status, ms, summary, detail };
}

/** The words every skipped SMT / proof stage carries. */
export function outsideSubsetWords(reason: string): string {
  return `outside the verifiable subset: ${reason}`;
}

export class TestedOptimizer {
  private rt: SessionRuntime;
  private opts: TestedOptions;
  private seen = new Set<string>();
  private sig: FunctionSignature;
  private original: JsProgram;
  private originalText: string;
  private dist!: Distribution;
  private candId = 0;
  private incumbentSource: string;
  private incumbentTiming = '';
  private previous: { source: string; rejection: Rejection } | null = null;
  private t0 = performance.now();

  constructor(rt: SessionRuntime, opts: TestedOptions) {
    const tested = rt.state.tested;
    if (!tested) throw new Error('start the Tested-only path first (runtime.startTestedOnly)');
    const sig = inferSignature(rt.fileText, rt.state.fn);
    if (!sig.ok) throw new Error(`inputs cannot be generated from the signature: ${sig.reason}`);
    this.rt = rt;
    this.opts = opts;
    this.sig = sig.sig;
    this.original = { source: rt.fileText, fnName: rt.state.fn };
    this.originalText = findFunction(rt.fileText, rt.state.fn)?.text ?? rt.fileText;
    this.incumbentSource = this.originalText;
  }

  private get refusal() {
    return this.rt.state.tested!.refusal;
  }
  private get specials() {
    return this.rt.state.tested!.specials;
  }
  private elapsedMin(): number {
    return (performance.now() - this.t0) / 60_000;
  }

  async run(): Promise<'threshold' | 'budget' | 'no-new-candidate' | 'user'> {
    const rt = this.rt;
    const fn = rt.state.fn;
    const sb = await rt.getSandbox();
    const cal = await calibrateSignatureDistribution(this.sig, this.original, sb);
    this.dist = cal.distribution;
    const base = await bench(this.original.source, fn, this.dist, { sandbox: sb, trials: this.opts.bench?.trials, minTrialMs: this.opts.bench?.minTrialMs, values: 'js' });
    const baseline = toSummary(base);
    this.incumbentTiming = `${base.pass.estimate.toFixed(3)} ms per pass over sizes ${cal.sizes.join(', ')} (95% CI ${base.pass.lo.toFixed(3)}–${base.pass.hi.toFixed(3)} ms); original.`;
    await rt.emit({ kind: 'optimize.started', threshold: this.opts.threshold, baseline, at: new Date().toISOString() });
    this.seen.add(normalizeSource(this.originalText));

    const noNewMax = this.opts.noNewRounds ?? 3;
    const maxRounds = this.opts.maxRounds ?? 12;
    let noNew = 0;
    for (let round = 1; round <= maxRounds; round++) {
      if (this.opts.signal?.aborted) return this.stop('user');
      if (this.opts.threshold.kind === 'time-budget' && this.elapsedMin() >= this.opts.threshold.minutes) return this.stop('budget');
      const prompt = buildTestedPrompt({
        fn,
        original: this.originalText,
        refusal: this.refusal,
        signature: signatureWords(this.sig),
        specials: this.specials,
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
        if (++noNew >= noNewMax) return this.stop('no-new-candidate');
        continue;
      }
      const norm = normalizeSource(source);
      if (this.seen.has(norm)) {
        if (++noNew >= noNewMax) return this.stop('no-new-candidate');
        continue;
      }
      this.seen.add(norm);
      noNew = 0;
      await this.funnel(round, source, callId);
      if (this.thresholdMet()) return this.stop('threshold');
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

  private async funnel(round: number, source: string, callId: number): Promise<CandidateRecord> {
    const rt = this.rt;
    const fn = rt.state.fn;
    const sb = await rt.getSandbox();
    const id = ++this.candId;
    const cand: CandidateRecord = { id, round, source, callId, stages: [], rejection: null, tier: null, outcome: 'running', bench: null, speedup: null };
    await rt.emit({ kind: 'candidate.proposed', candidate: cand });
    const done = (r: StageResult) => rt.emit({ kind: 'stage.result', candidateId: id, result: r });
    const reject = async (rej: Rejection): Promise<CandidateRecord> => {
      this.previous = { source, rejection: rej };
      await rt.emit({ kind: 'candidate.decided', candidateId: id, outcome: 'rejected', tier: null, rejection: rej, bench: null, speedup: null });
      return { ...cand, outcome: 'rejected', rejection: rej };
    };

    // 1. compile (same signature as the original)
    const c = await compileGate({ candidate: source, fnName: fn, original: rt.fileText });
    await done(stage('compile', c.ok ? 'pass' : 'fail', c.ms, c.ok ? 'compiles under strict TypeScript; signature matches' : `${c.diagnostics.filter((d) => d.category === 'error').length} error(s)`));
    if (!c.ok) {
      const d = c.diagnostics.find((x) => x.category === 'error');
      return reject({ stage: 'compile', kind: 'compile-error', reason: d ? `line ${d.line}: ${d.message}` : 'did not compile' });
    }

    // inputs from the signature; the original screens them (it must return or throw within 100 ms)
    const nDiff = this.opts.differentialInputs ?? 1000;
    const seed = 7000 + id;
    const gen = generateSignatureInputs(this.sig, { n: nDiff, seed, specials: this.specials });
    const screen = await screenOriginal(sb, this.original, gen.inputs, 100);

    // 2. purity
    const pu = await purityGate(sb, { id: `purity:${id}`, source, fnName: fn, sample: screen.fast.slice(0, 50), values: 'js' });
    await sb.unload(`purity:${id}`).catch(() => undefined);
    await done(stage('purity', pu.ok ? 'pass' : 'fail', pu.ms, pu.ok ? 'pure on a sample: no I/O, clock, randomness or input mutation' : `impure: ${pu.loadError ?? pu.violations.map((v) => v.kind).join(', ')}`));
    if (!pu.ok) return reject({ stage: 'purity', kind: 'impure', reason: pu.loadError ?? `the candidate ${pu.violations.map((v) => v.kind).join(', ')}` });

    // 3. differential against the original + the mutation check of the original on the same inputs
    const td0 = performance.now();
    const rep = await jsVsJs(this.original, { source, fnName: fn }, screen.fast, { sandbox: sb, perCallMs: 500 });
    if (rep.differences.length || rep.loadError) {
      const d = rep.differences[0];
      await done(stage('differential', 'fail', performance.now() - td0, `differs from the original on ${rep.differences.length} of ${rep.compared} inputs`));
      return reject({
        stage: 'differential',
        kind: 'counterexample',
        reason: d
          ? `the candidate ${d.zeroSignOnly ? 'differs from the original only in the sign of a zero (-0 versus 0)' : 'returns a different result'} for (${showJsArgs(d.args)})`
          : `the candidate did not load: ${rep.loadError}`,
        counterexample: d ? { input: d.args, original: d.original, candidate: d.candidate, source: 'differential' } : undefined,
      });
    }
    let mut: { caught: number; total: number; undistinguished: number; seed: number } | undefined;
    try {
      const mr = await mutationCheck(this.original.source, fn, screen.fast.slice(0, 300), { seed: 11, sandbox: sb, values: 'js', perCallMs: 200, secondPassInputs: 200 });
      mut = { caught: mr.caught, total: mr.total, undistinguished: mr.notDistinguished, seed: 11 };
    } catch {
      mut = undefined;
    }
    // counted over the inputs actually compared (the screen may drop some)
    const nonIntegerInputs = screen.fast.filter((a) => a.some(containsNonInteger)).length;
    const specialInputs = screen.fast.filter((a) => a.some(containsSpecialNumber)).length;
    const extras = [
      screen.slow ? `${screen.slow} inputs skipped: the original takes more than 100 ms` : '',
      screen.faults ? `${screen.faults} inputs skipped: the original fails on them` : '',
    ].filter(Boolean);
    await done(
      stage(
        'differential',
        'pass',
        performance.now() - td0,
        `${rep.compared} inputs from the signature (${nonIntegerInputs} with non-integer numbers${this.specials ? `, ${specialInputs} with NaN, Infinity or -0` : ''}), no difference${extras.length ? ` (${extras.join('; ')})` : ''}${mut ? `; ${mut.caught} of ${mut.total} broken copies of the original caught` : ''}`,
        {
          stage: 'differential',
          generated: gen.generated,
          requested: nDiff,
          skippedSlow: screen.slow,
          skippedFaults: screen.faults,
          compared: rep.compared,
          seed,
          mutation: mut,
          generator: 'signature',
          nonIntegerInputs,
          specialInputs,
          specials: this.specials,
        },
      ),
    );

    // 4-5. no model: SMT and proof are skipped, with the translator's reason
    const why = outsideSubsetWords(this.refusal.reason);
    await done(stage('smt', 'skipped', 0, why, { stage: 'smt-skipped', reason: 'outside-subset', refusalCode: this.refusal.code }));
    await done(stage('proof', 'skipped', 0, why, { stage: 'proof-skipped', reason: 'outside-subset', refusalCode: this.refusal.code }));

    // 6. benchmark against the original (and the incumbent)
    const tb0 = performance.now();
    const bo = { sandbox: sb, trials: this.opts.bench?.trials, minTrialMs: this.opts.bench?.minTrialMs, values: 'js' as const };
    const rep2 = await compare({ source, fnName: fn }, this.original, this.dist, bo);
    const vsOriginal = toSpeedup(rep2.overall);
    let vsIncumbent = vsOriginal;
    const inc = rt.state.optimize.candidates.find((x) => x.id === rt.state.optimize.incumbentId);
    if (inc) vsIncumbent = toSpeedup((await compare({ source, fnName: fn }, { source: inc.source, fnName: fn }, this.dist, bo)).overall);
    const benchSummary = toSummary(rep2.candidate);
    await done(
      stage(
        'benchmark',
        'pass',
        performance.now() - tb0,
        vsOriginal.significant ? `faster than the original: ${vsOriginal.ratio.toFixed(1)}× (95% CI ${vsOriginal.lo.toFixed(1)}–${vsOriginal.hi.toFixed(1)})` : 'not distinguishable from the original (intervals overlap)',
        { stage: 'benchmark', trials: rep2.trials, distribution: this.dist.name, sizes: this.dist.sizes },
      ),
    );

    const tier: Tier = 'tested';
    const faster = vsIncumbent.significant;
    const outcome: CandidateRecord['outcome'] = faster ? 'incumbent' : 'rejected';
    const rejection: Rejection | null = faster
      ? null
      : { stage: 'benchmark', kind: 'not-faster', reason: inc ? 'behaves like the original on every generated input, but is not faster than the current best (intervals overlap)' : 'behaves like the original on every generated input, but is not faster than the original (intervals overlap)' };
    if (rejection) this.previous = { source, rejection };
    await rt.emit({ kind: 'candidate.decided', candidateId: id, outcome, tier, rejection, bench: benchSummary, speedup: vsOriginal });
    if (outcome === 'incumbent') {
      this.incumbentSource = source;
      this.incumbentTiming = `${rep2.candidate.pass.estimate.toFixed(3)} ms per pass (95% CI ${rep2.candidate.pass.lo.toFixed(3)}–${rep2.candidate.pass.hi.toFixed(3)} ms); ${vsOriginal.ratio.toFixed(1)}× faster than the original.`;
      await rt.emit({ kind: 'incumbent.changed', candidateId: id });
    }
    return { ...cand, outcome, tier, rejection };
  }
}

// ───────────── delivery ─────────────

export function testedVerifyMarkdown(fn: string, dir: string, p: { refusalCode: string; refusalReason: string; inputs: number | null; seed: number | null; specials: boolean; changed: boolean }): string {
  return [
    `# Re-checking ${fn} (${TIER_LABEL.tested} tier only)`,
    '',
    `\`${fn}\` is outside the verifiable subset (refusal \`${p.refusalCode}\`): ${p.refusalReason}`,
    '',
    'So there is no Lean model, no agreed spec, no proof and no SMT check for it, and nothing here re-checks one. The only claim is the Tested one: the optimized function behaved like the original on generated inputs.',
    '',
    '```',
    `faithful verify ${dir}`,
    '```',
    '',
    p.changed && p.inputs !== null
      ? `This recomputes the hashes in \`${fn}.provenance.json\` and re-runs the differential test: the optimized function against the original on the same ${p.inputs} inputs generated from the TypeScript signature (seed ${p.seed}${p.specials ? '; NaN, Infinity, -Infinity and -0 included' : '; NaN, Infinity and -0 not generated'}), compared as follows: ${TESTED_EQUALITY}. ${TESTED_EXCLUSIONS}.`
      : `This recomputes the hashes in \`${fn}.provenance.json\`. No optimized function was delivered, so there is no differential to re-run.`,
    '',
    ...(p.changed ? ['To apply the optimized function: `git apply ' + `${dir}/patch.diff` + '` (Faithful never modifies your files).', ''] : []),
  ].join('\n');
}

export async function deliverTested(rt: SessionRuntime): Promise<{ dir: string; files: string[]; evidence: string }> {
  const s = rt.state;
  const tested = s.tested;
  if (!tested) throw new Error('nothing to deliver on the Tested-only path: it was not started');
  const fn = s.fn;
  const o = s.optimize;
  const inc = o.candidates.find((c) => c.id === o.incumbentId) ?? null;
  const stamp = stampFrom(s.toolchain ?? (await (await import('@faithful/core')).captureToolchain()));
  const originalText = findFunction(rt.fileText, fn)?.text ?? rt.fileText;
  const optimizedSource = inc ? inc.source : originalText;
  const dd = inc?.stages.find((x) => x.stage === 'differential')?.detail;
  const detail = isDifferentialDetail(dd) ? (dd as typeof dd & { requested?: number }) : null;
  const claims: Claim[] = [];
  let mutation: { caught: number; total: number } | undefined;
  if (inc && detail) {
    claims.push({
      kind: 'candidate-vs-original-differential',
      tier: 'tested',
      statement: `The optimized function returned the same result as the original (or threw the same message) on ${detail.compared} inputs generated from its TypeScript signature${detail.mutation ? `, and the same inputs caught ${detail.mutation.caught} of ${detail.mutation.total} broken copies of the original` : ' (the mutation check did not run)'}. The original is outside the verifiable subset: no spec, proof or SMT check exists for it.`,
      inputs: detail.compared,
      seed: detail.seed,
      mutation: detail.mutation ? { caught: detail.mutation.caught, total: detail.mutation.total, undistinguished: detail.mutation.undistinguished } : undefined,
    });
    if (detail.mutation) mutation = { caught: detail.mutation.caught, total: detail.mutation.total };
  }
  const deliveredTier: Tier = inc && detail ? 'tested' : 'not-proved';
  const speed = inc?.speedup ? { ratio: { estimate: inc.speedup.ratio, lo: inc.speedup.lo, hi: inc.speedup.hi }, verdict: inc.speedup.significant ? ('faster' as const) : ('not-distinguished' as const) } : undefined;
  const evidence = buildEvidenceBlock({ stamp, differential: detail && inc ? { inputs: detail.compared } : undefined, mutation, speed } as never);

  const dir = `.faithful/${fn}`;
  const files: string[] = [];
  const write = async (rel: string, text: string) => {
    files.push(rel);
    await rt.store.writeText(fn, rel, text);
  };
  let patch = '';
  if (inc && s.file) {
    const span = findFunction(rt.fileText, fn);
    if (!span) throw new Error(`could not find function ${fn} in ${s.file}`);
    const note = `// Optimized by Faithful (${TIER_LABEL.tested}; outside the verifiable subset, nothing proved). Claims and re-check commands: ${dir}/${fn}.provenance.json\n`;
    const next = rt.fileText.slice(0, span.start) + note + extractCandidateFunction(optimizedSource, fn) + rt.fileText.slice(span.end);
    patch = createTwoFilesPatch(`a/${s.file}`, `b/${s.file}`, rt.fileText, next, '', '', { context: 3 });
  }
  const prov: Provenance = {
    schema: 1,
    fn,
    file: s.file,
    generatedAt: new Date().toISOString(),
    stamp,
    deliveredTier,
    hashes: { originalSource: hashText(originalText), optimizedSource: hashText(optimizedSource), patch: hashText(patch), leanFile: '', model: '', spec: '', agreement: '' },
    originalSource: originalText,
    originalFileSource: rt.fileText,
    optimizedSource,
    preconditions: [],
    carveOuts: [],
    rulings: [],
    claims,
    benchmark: o.baseline ? { baseline: o.baseline, incumbent: inc?.bench ?? null, speedup: inc?.speedup ?? null, distribution: o.baseline.distribution, sizes: o.baseline.sizes } : null,
    candidates: o.candidates.map((c) => ({ id: c.id, round: c.round, sourceHash: hashText(c.source), outcome: c.outcome, tier: c.tier, rejection: c.rejection, speedup: c.speedup })),
    codex: { calls: s.calls.length, failed: s.calls.filter((c) => c.error).length, model: stamp.modelId, effort: stamp.toolchain.codex.effort, version: stamp.toolchain.codex.version },
    caveats: [
      `Outside the verifiable subset (refusal ${tested.refusal.code}, line ${tested.refusal.span.line}, column ${tested.refusal.span.column}): ${tested.refusal.reason}`,
      'No Lean model, agreed spec, proof or SMT check exists for this function. The only evidence is the differential test against the original on inputs generated from the TypeScript signature, the mutation check, and the benchmark.',
      `Inputs were generated from the signature ${tested.signature}: integers and non-integer doubles${tested.specials ? ', and NaN, Infinity, -Infinity and -0 (opted in)' : '; NaN, Infinity, -Infinity and -0 were not generated as inputs'}.`,
      `Outcomes were compared as follows: ${TESTED_EQUALITY}.`,
      `${TESTED_EXCLUSIONS}.`,
      ...(deliveredTier === 'not-proved' ? ['No optimized function was delivered; nothing is claimed.'] : []),
    ],
    testedOnly: {
      refusal: { code: tested.refusal.code, reason: tested.refusal.reason, span: tested.refusal.span },
      signature: tested.signature,
      generator: { kind: 'signature', seed: detail?.seed ?? 0, n: detail?.requested ?? detail?.compared ?? 0, specials: tested.specials },
      equality: TESTED_EQUALITY,
    },
  };
  await write('patch.diff', patch || '# no optimized function was delivered (no incumbent)\n');
  await write(`${fn}.provenance.json`, JSON.stringify(prov, null, 2) + '\n');
  await write(
    'VERIFY.md',
    testedVerifyMarkdown(fn, dir, { refusalCode: tested.refusal.code, refusalReason: tested.refusal.reason, inputs: detail?.compared ?? null, seed: detail?.seed ?? null, specials: tested.specials, changed: !!inc }),
  );
  await rt.emit({ kind: 'deliver.done', dir, files, at: new Date().toISOString() });
  return { dir, files, evidence: evidence.text };
}

// ───────────── verify ─────────────

export interface TestedVerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * `faithful verify` for a Tested-only provenance (called by verify.ts after the hash checks): confirms the provenance
 * makes no proof or SMT claim, regenerates the recorded inputs from the signature and re-runs the differential. Says
 * plainly that no proof or SMT claim exists.
 */
export async function verifyTestedOnly(prov: Provenance, add: (name: string, ok: boolean, detail: string) => void, log: (s: string) => void, sb: Sandbox): Promise<{ evidence: string | null }> {
  const t = prov.testedOnly!;
  log(`  ${prov.fn} is outside the verifiable subset (refusal ${t.refusal.code}): ${t.refusal.reason}`);
  log('  No Lean model, spec, proof or SMT claim exists for it; only the Tested claim is re-checked.');
  const onlyTested = prov.claims.every((c) => c.kind === 'candidate-vs-original-differential' && c.tier === 'tested') && (prov.deliveredTier === 'tested' || prov.deliveredTier === 'not-proved') && !prov.hashes.leanFile;
  add('claims', onlyTested, onlyTested ? 'the provenance makes no proof or SMT claim (Tested tier only)' : 'the provenance of a refused function claims more than the Tested tier');
  const dc = prov.claims.find((c) => c.kind === 'candidate-vs-original-differential');
  if (!dc || prov.optimizedSource === prov.originalSource) return { evidence: null };
  const sig = inferSignature(prov.originalFileSource, prov.fn);
  if (!sig.ok) {
    add('signature', false, `inputs can no longer be generated from the signature: ${sig.reason}`);
    return { evidence: null };
  }
  add('signature', signatureWords(sig.sig) === t.signature, `${signatureWords(sig.sig)}${signatureWords(sig.sig) === t.signature ? '' : ` (recorded: ${t.signature})`}`);
  const original = { source: prov.originalFileSource, fnName: prov.fn };
  const gen = generateSignatureInputs(sig.sig, { n: t.generator.n, seed: t.generator.seed, specials: t.generator.specials });
  const screen = await screenOriginal(sb, original, gen.inputs, 100);
  const rep = await jsVsJs(original, { source: prov.optimizedSource, fnName: prov.fn }, screen.fast, { sandbox: sb, perCallMs: 500 });
  const d = rep.differences[0];
  add(
    'differential',
    rep.differences.length === 0 && !rep.loadError,
    `${rep.compared} inputs from the signature compared (seed ${t.generator.seed}), ${rep.differences.length} differences${rep.compared !== dc.inputs ? ` (recorded: ${dc.inputs} inputs)` : ''}${d ? `; first: (${showJsArgs(d.args)}) original ${showJsOutcome(d.original)}, optimized ${showJsOutcome(d.candidate)}` : ''}`,
  );
  const stamp = stampFrom(await (await import('@faithful/core')).captureToolchain());
  const ev = buildEvidenceBlock({ stamp, differential: { inputs: rep.compared } } as never).text;
  return { evidence: `${ev} ${TIER_LABEL.tested} tier only: no proof or SMT claim exists for this function.` };
}


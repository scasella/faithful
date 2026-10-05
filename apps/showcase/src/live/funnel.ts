/**
 * The candidate funnel's first four stages, run in the visitor's browser with the same engine/translator/SMT code and
 * the same parameters as the tool's optimizer (packages/cli/src/flow/optimize.ts `funnel`):
 *   compile      compileGate({ candidate, fnName, original: <original file> })
 *   inputs       generateInputs(params, preconditions + carve-outs, n = 1000, seed = 7000 + candidate id), then the
 *                inputs on which the instrumented original does not finish within 100 ms are screened out
 *   purity       purityGate on the first 50 inputs (each called twice)
 *   differential tsVsTs(translation, candidate, inputs, perCallMs 500); with throw-as-precondition, inputs where the
 *                original throws decide nothing (as in the optimizer)
 *   smt          verifiedToK(original IR, candidate IR, budget 60 s) with Z3 WASM, when the page is cross-origin isolated
 * Not run here: the mutation check of the differential stage, the Lean proof, the benchmark.
 *
 * Every number this returns was measured just now in this browser; nothing is copied from the recording.
 */
import type { Rejection } from '@faithful/session';
import { translateWithIr, type Outcome, type Translation, type Val } from '@faithful/translate';
import { verifiedToK, type VerifiedToK } from '@faithful-smt-src/equivalence.ts';
import type { Sandbox as EngineSandbox } from '@faithful-engine-src/sandbox/sandbox.ts';
import { Sandbox, compileGate, generateInputs, instrumentedSandboxSource, INSTRUMENTED_ENTRY, purityGate, tsVsTs } from './engine';
import { installTsSys } from './tsSys';
import { browserZ3, solveLog, z3Available, Z3_VERSION } from './z3Driver';
import type { LiveInputs } from '../site/recording';

export type LiveStageId = 'translate' | 'compile' | 'purity' | 'differential' | 'smt';
export type LiveStatus = 'running' | 'pass' | 'fail' | 'skipped' | 'unavailable';

export interface LiveStage {
  stage: LiveStageId;
  status: LiveStatus;
  /** Wall-clock ms in this browser. */
  ms: number;
  summary: string;
  /** Extra facts for display. */
  facts?: string[];
}

export interface LiveCounterexample {
  input: Val[];
  original: Outcome;
  candidate: Outcome;
  source: 'differential' | 'smt';
}

export interface LiveRun {
  stages: LiveStage[];
  rejection: Rejection | null;
  counterexample: LiveCounterexample | null;
  /** All stages that ran passed (the tool would continue to the Lean proof and the benchmark, not run here). */
  passed: boolean;
  totalMs: number;
  at: string;
  userAgent: string;
}

let sandboxP: Promise<Sandbox> | null = null;
export function liveSandbox(): Promise<Sandbox> {
  sandboxP ??= Sandbox.open();
  return sandboxP;
}

/** Same rule as the optimizer: a throw is a precondition when the agreement says so. */
function noThrowPrecondition(li: LiveInputs): boolean {
  const t = li.translation;
  if (li.agreement?.preconditions.some((p) => p.kind === 'no-throw')) return true;
  return !!t?.canThrow && li.throwChoice === 'precondition';
}

async function screenFastInputs(t: Translation, inputs: Val[][], sb: Sandbox, ms: number): Promise<{ fast: Val[][]; slow: number; excluded: number }> {
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

/**
 * At run time every engine import of its Sandbox IS the browser Sandbox (vite.config.ts redirect); the type checker
 * sees the engine's Node declaration, whose private fields differ. Same public API.
 */
const asEngine = (sb: Sandbox): EngineSandbox => sb as unknown as EngineSandbox;

const yieldToPage = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export interface FunnelOptions {
  /** Candidate id: the input seed is 7000 + id, as in the optimizer (a recorded candidate keeps its recorded seed). */
  id: number;
  differentialInputs?: number;
  smtBudgetMs?: number;
  onUpdate?(run: LiveRun): void;
  /** For a recorded candidate: its recorded SMT stage, shown (labelled replayed) when Z3 cannot run here. */
  recordedSmt?: { summary: string; date: string; z3: string };
}

export async function runFunnel(li: LiveInputs, candidateSource: string, opts: FunnelOptions): Promise<LiveRun> {
  installTsSys();
  const t0 = performance.now();
  const run: LiveRun = { stages: [], rejection: null, counterexample: null, passed: false, totalMs: 0, at: new Date().toISOString(), userAgent: navigator.userAgent };
  const emit = (): void => {
    run.totalMs = performance.now() - t0;
    opts.onUpdate?.({ ...run, stages: run.stages.map((s) => ({ ...s })) });
  };
  const begin = async (stage: LiveStageId, summary: string): Promise<LiveStage> => {
    const s: LiveStage = { stage, status: 'running', ms: 0, summary };
    run.stages.push(s);
    emit();
    await yieldToPage();
    return s;
  };
  const end = (s: LiveStage, status: LiveStatus, ms: number, summary: string, facts?: string[]): void => {
    s.status = status;
    s.ms = ms;
    s.summary = summary;
    if (facts) s.facts = facts;
    emit();
  };
  const reject = (rej: Rejection): LiveRun => {
    run.rejection = rej;
    if (rej.counterexample) run.counterexample = rej.counterexample;
    emit();
    return run;
  };

  const t = li.translation;
  if (!t) throw new Error('the recording has no successful translation, so there is nothing to compare against');
  const fnName = li.fnName;

  // 0. translate (live): the deterministic translator, run here on the original file, must reproduce the recorded model.
  {
    const s = await begin('translate', 'translating the original in your browser…');
    const a = performance.now();
    const live = translateWithIr(li.originalFile, fnName);
    const ms = performance.now() - a;
    if (!live.result.ok) {
      end(s, 'fail', ms, `the translator refused the original here: ${live.result.refusal.reason}`);
    } else {
      const same = live.result.lean.hash === t.lean.hash;
      end(s, same ? 'pass' : 'fail', ms, same ? 'the translator, run here, produced the same Lean model as the recording' : 'the translator, run here, produced a DIFFERENT Lean model from the recording', [
        `model hash here ${live.result.lean.hash.slice(0, 19)}…, recorded ${t.lean.hash.slice(0, 19)}…`,
      ]);
    }
  }

  // 1. compile
  {
    const s = await begin('compile', 'type-checking under strict TypeScript…');
    const c = compileGate({ candidate: candidateSource, fnName, original: li.originalFile });
    if (!c.ok) {
      const errs = c.diagnostics.filter((d) => d.category === 'error');
      end(s, 'fail', c.ms, `${errs.length} error(s)`, errs.slice(0, 5).map((d) => `${d.file} line ${d.line}: ${d.message}`));
      const d = errs[0];
      return reject({ stage: 'compile', kind: 'compile-error', reason: d ? `line ${d.line}: ${d.message}` : 'did not compile' });
    }
    end(s, 'pass', c.ms, 'compiles under strict TypeScript; signature matches the original');
  }

  const sb = await liveSandbox();

  // inputs (as the optimizer draws them)
  const n = opts.differentialInputs ?? 1000;
  const seed = 7000 + opts.id;
  const gen0 = generateInputs({ params: t.params, preconditions: [...t.preconditions, ...li.carveOuts] }, { n, seed });
  const screen = await screenFastInputs(t, gen0.inputs, sb, 100);
  const inputs = screen.fast;

  // 2. purity
  {
    const s = await begin('purity', 'running a sample twice under the purity mask…');
    // totalMs bounds the whole sample (the tool passes none): a visitor's `while (true) {}` must not hold the page for
    // 100 x 2 s. Calls not run when it runs out count as "did not finish" below.
    const pu = await purityGate(asEngine(sb), { id: `purity:${opts.id}`, source: candidateSource, fnName, sample: inputs.slice(0, 50) }, { totalMs: 8_000 });
    await sb.unload(`purity:${opts.id}`).catch(() => undefined);
    // Showcase rule (the tool would instead reject it at the differential, where a timeout is a fault and never
    // agreement, after paying 500 ms per input): a candidate that does not finish on a sample input stops here.
    const slowAt = pu.report?.outcomes.findIndex((o) => o.tag === 'fault' && (o.detail === 'timeout' || o.detail.startsWith('not run'))) ?? -1;
    if (pu.ok && slowAt >= 0) {
      const input = inputs[slowAt]!;
      end(s, 'fail', pu.ms, 'the candidate did not finish within 2 s on a sample input', [`input ${JSON.stringify(input)}; the tool would reject it at the differential stage (a timeout is never agreement)`]);
      return reject({ stage: 'purity', kind: 'other', reason: `the candidate did not finish within 2 s on ${JSON.stringify(input)}` });
    }
    if (!pu.ok) {
      const what = pu.loadError ?? pu.violations.map((v) => `${v.kind}: ${v.what}`).join('; ');
      end(s, 'fail', pu.ms, `impure: ${pu.loadError ?? pu.violations.map((v) => v.kind).join(', ')}`, [what]);
      return reject({ stage: 'purity', kind: 'impure', reason: pu.loadError ?? `the candidate ${pu.violations.map((v) => `${v.kind} (${v.what})`).join(', ')}` });
    }
    end(s, 'pass', pu.ms, `pure on a sample of ${Math.min(50, inputs.length)} inputs: no I/O, clock, randomness or input mutation`);
  }

  // 3. differential
  {
    const s = await begin('differential', `comparing the candidate with the original on ${inputs.length} generated inputs…`);
    const a = performance.now();
    const rep = await tsVsTs(t, { source: candidateSource, fnName }, inputs, { sandbox: asEngine(sb), perCallMs: 500 });
    const cr = rep.candidates[0]!;
    const noThrow = noThrowPrecondition(li);
    const decides = (o: Outcome): boolean => !(noThrow && o.tag === 'throw');
    const bad = cr.disagreements.find((d) => decides(d.original));
    const facts = [
      `${gen0.generated} inputs generated under the agreed preconditions${li.carveOuts.length ? ' and carve-outs' : ''} (seed ${seed})`,
      ...(screen.slow ? [`${screen.slow} inputs skipped: the original takes more than 100 ms on them`] : []),
      ...(noThrow ? ['inputs on which the original throws decide nothing (throwing is a precondition in this agreement)'] : []),
    ];
    if (bad || cr.loadError) {
      end(s, 'fail', performance.now() - a, `differs from the original on ${cr.disagreements.filter((d) => decides(d.original)).length} of ${cr.compared} inputs`, facts);
      const d = bad ?? cr.disagreements[0];
      return reject({
        stage: 'differential',
        kind: 'counterexample',
        reason: d ? `the candidate returns a different result for ${JSON.stringify(d.args)}` : `the candidate did not load: ${cr.loadError}`,
        counterexample: d ? { input: d.args, original: d.original, candidate: d.candidate, source: 'differential' } : undefined,
      });
    }
    end(s, 'pass', performance.now() - a, `${cr.compared} inputs, no difference`, facts);
  }

  // 4. SMT
  {
    const s = await begin('smt', 'encoding both functions and asking Z3 for a distinguishing input…');
    const avail = z3Available();
    if (!avail.ok) {
      const rec = opts.recordedSmt;
      end(s, 'unavailable', 0, `not run in this browser: ${avail.why}`, rec ? [`replayed (recorded on ${rec.date} with Z3 ${rec.z3}): ${rec.summary}`] : undefined);
    } else {
      const a = performance.now();
      const orig = translateWithIr(li.originalFile, fnName);
      const cand = translateWithIr(candidateSource, fnName);
      if (!orig.result.ok || !orig.ir) {
        end(s, 'skipped', performance.now() - a, 'the original has no IR');
      } else if (!cand.result.ok || !cand.ir) {
        end(s, 'skipped', performance.now() - a, `no SMT check: the candidate is outside the verifiable subset (${cand.result.ok ? 'no IR' : cand.result.refusal.reason})`);
      } else {
        const before = solveLog.length;
        let r: VerifiedToK;
        try {
          r = await verifiedToK({ translation: orig.result, ir: orig.ir }, { translation: cand.result, ir: cand.ir }, { budgetMs: opts.smtBudgetMs ?? 60_000, z3: browserZ3(), sandbox: sb });
        } catch (e) {
          end(s, 'skipped', performance.now() - a, `the SMT check failed to run: ${(e as Error).message}`);
          r = null as unknown as VerifiedToK;
        }
        if (r) {
          const res = r.result;
          const queries = solveLog.slice(before);
          const facts = [
            `Z3 ${Z3_VERSION} (z3-solver WASM) in this browser: ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}, ${queries.map((q) => `${q.status} in ${Math.round(q.totalMs)} ms (WASM start ${Math.round(q.initMs)} ms)`).join('; ')}`,
            res.encodingNote,
          ];
          const ms = performance.now() - a;
          if (res.status === 'unsat') end(s, 'pass', ms, `Verified to k=${res.k}: no distinguishing input up to that bound`, facts);
          else if (res.status === 'sat' && res.counterexample) {
            const c = res.counterexample;
            end(s, 'fail', ms, `Z3 found an input where the candidate differs (k=${res.k})`, facts);
            return reject({ stage: 'smt', kind: 'smt-counterexample', reason: `a distinguishing input exists: ${JSON.stringify(c.input)}`, counterexample: { input: c.input, original: c.original, candidate: c.candidate, source: 'smt' } });
          } else end(s, 'skipped', ms, `no verdict: ${res.reason ?? res.status}`, facts);
        }
      }
    }
  }

  // "Passed" only when every stage that gave a verdict passed and none was left without one (an SMT "unknown" or
  // timeout is no verdict; SMT not available in this browser is not run).
  run.passed = run.stages.every((x) => x.status === 'pass' || x.status === 'unavailable');
  emit();
  return run;
}

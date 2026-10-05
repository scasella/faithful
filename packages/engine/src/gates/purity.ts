/**
 * Purity gate: load a candidate into a Sandbox and run the sandbox's purity checks on a sample of inputs
 * (ambient-global traps, intrinsic integrity, input mutation, two-calls-agree determinism).
 *
 * Evidence, not proof: a sample that never reaches an impure branch passes. The verdict is reported as
 * the structured violations the sandbox saw.
 */
import type { Val } from '@faithful/translate';
import type { PurityViolation } from '../sandbox/mask.js';
import type { BatchOptions, PurityReport, Sandbox } from '../sandbox/sandbox.js';

export interface PurityGateInput {
  /** Sandbox id to load under (replaces any function loaded under that id). */
  id: string;
  source: string;
  fnName: string;
  sample: Val[][];
  instrumented?: boolean;
  /** Value domain of the load (see `LoadOptions.values`); `'js'` for functions outside the verifiable subset. */
  values?: 'subset' | 'js';
  /**
   * Whether an argument mutation fails the gate. Default true. (In-place `sort` on an argument is a mutation; the
   * caller decides whether the subset's value semantics tolerate it. It is reported either way.)
   */
  failOnInputMutation?: boolean;
}

export interface PurityGateResult {
  gate: 'purity';
  ok: boolean;
  /** Load failure (syntax, function missing, impure top-level code), when the function never ran. */
  loadError?: string;
  violations: PurityViolation[];
  report?: PurityReport;
  sampleSize: number;
  ms: number;
}

export async function purityGate(sb: Sandbox, input: PurityGateInput, opts: BatchOptions = {}): Promise<PurityGateResult> {
  const t0 = performance.now();
  const loaded = await sb.load(input.id, input.source, input.fnName, { instrumented: input.instrumented ?? false, values: input.values });
  if (!loaded.ok) {
    return {
      gate: 'purity',
      ok: false,
      loadError: loaded.error,
      violations: loaded.violations,
      sampleSize: input.sample.length,
      ms: performance.now() - t0,
    };
  }
  const report = await sb.checkPurity(input.id, input.sample, opts);
  const failOnMutation = input.failOnInputMutation ?? true;
  const blocking = report.violations.filter((v) => failOnMutation || v.kind !== 'input-mutation');
  return {
    gate: 'purity',
    ok: blocking.length === 0,
    violations: report.violations,
    report,
    sampleSize: input.sample.length,
    ms: performance.now() - t0,
  };
}

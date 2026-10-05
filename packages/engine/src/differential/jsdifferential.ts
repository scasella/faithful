/**
 * Differential test for the Tested-only path: a candidate against the ORIGINAL function (no translation, no Lean model, no
 * preconditions), both loaded in the sandbox's `'js'` value domain, on inputs from `generateSignatureInputs`. The
 * original is the reference: on every input where the original returns or throws, the candidate must produce the same
 * outcome under `jsOutcomeEqual` (NaN equals NaN; -0 and 0 differ; same thrown message). An input on which the original
 * faults (timeout, crash, a non-plain result) decides nothing and is excluded and counted. A candidate fault on a
 * compared input is a difference.
 */
import type { Outcome, Val } from '@faithful/translate';
import { Sandbox } from '../sandbox/sandbox.js';
import { differsOnlyInZeroSign, jsOutcomeEqual } from './jsvalues.js';

export interface JsProgram {
  source: string;
  fnName: string;
}

export interface JsDifference {
  args: Val[];
  original: Outcome;
  candidate: Outcome;
  /** The two results are equal except for the sign of a zero (-0 vs 0). Still a difference; said in those words. */
  zeroSignOnly: boolean;
}

export interface JsVsJsReport {
  inputs: number;
  /** Inputs on which the original faulted (excluded). */
  originalFaults: number;
  originalFaultSamples: Array<{ args: Val[]; outcome: Outcome }>;
  /** Inputs on which the original returned or threw: the comparison basis. */
  compared: number;
  agreements: number;
  differences: JsDifference[];
  /** The candidate did not load: every compared input is a difference. */
  loadError: string | null;
  /** Compared inputs the candidate mutated (reported; the outcome is still compared). */
  mutatedInputs: number;
  ms: number;
}

let seq = 0;

/** Outcomes of one program on inputs, in the `'js'` value domain. */
export async function runJs(sb: Sandbox, p: JsProgram, inputs: Val[][], perCallMs: number): Promise<{ loadError: string | null; outcomes: Outcome[]; mutated: boolean[]; ms: number[] }> {
  const id = `jsVsJs:${++seq}`;
  const l = await sb.load(id, p.source, p.fnName, { values: 'js' });
  if (!l.ok) return { loadError: l.error, outcomes: inputs.map(() => ({ tag: 'fault', detail: `did not load: ${l.error}` })), mutated: inputs.map(() => false), ms: inputs.map(() => 0) };
  try {
    const r = await sb.callBatch(id, inputs, { perCallMs });
    return { loadError: null, outcomes: r.results.map((x) => x.outcome), mutated: r.results.map((x) => x.violations.some((v) => v.kind === 'input-mutation')), ms: r.results.map((x) => x.ms) };
  } finally {
    await sb.unload(id).catch(() => undefined);
  }
}

/** Compare `candidate` with `original` on `inputs`. See the module comment. */
export async function jsVsJs(original: JsProgram, candidate: JsProgram, inputs: Val[][], deps: { sandbox?: Sandbox; perCallMs?: number } = {}): Promise<JsVsJsReport> {
  const own = deps.sandbox ? null : await Sandbox.open();
  const sb = deps.sandbox ?? own!;
  const perCallMs = deps.perCallMs ?? 1000;
  const t0 = performance.now();
  try {
    const o = await runJs(sb, original, inputs, perCallMs);
    if (o.loadError) throw new Error(`jsVsJs: the original did not load: ${o.loadError}`);
    const live: number[] = [];
    const rep: JsVsJsReport = { inputs: inputs.length, originalFaults: 0, originalFaultSamples: [], compared: 0, agreements: 0, differences: [], loadError: null, mutatedInputs: 0, ms: 0 };
    o.outcomes.forEach((oc, k) => {
      if (oc.tag === 'ok' || oc.tag === 'throw') live.push(k);
      else {
        rep.originalFaults++;
        if (rep.originalFaultSamples.length < 5) rep.originalFaultSamples.push({ args: inputs[k]!, outcome: oc });
      }
    });
    rep.compared = live.length;
    const c = await runJs(sb, candidate, live.map((k) => inputs[k]!), perCallMs);
    rep.loadError = c.loadError;
    live.forEach((k, j) => {
      const a = o.outcomes[k]!;
      const b = c.outcomes[j]!;
      if (c.mutated[j]) rep.mutatedInputs++;
      if (jsOutcomeEqual(a, b)) rep.agreements++;
      else rep.differences.push({ args: inputs[k]!, original: a, candidate: b, zeroSignOnly: differsOnlyInZeroSign(a, b) });
    });
    rep.ms = performance.now() - t0;
    return rep;
  } finally {
    if (own) await own.close();
  }
}

/** Inputs on which the original returns or throws within `ms` (the others are counted, not compared). */
export async function screenOriginal(sb: Sandbox, original: JsProgram, inputs: Val[][], ms: number): Promise<{ fast: Val[][]; slow: number; faults: number }> {
  const o = await runJs(sb, original, inputs, ms);
  if (o.loadError) throw new Error(`the original did not load in the sandbox: ${o.loadError}`);
  const fast: Val[][] = [];
  let slow = 0;
  let faults = 0;
  o.outcomes.forEach((oc, i) => {
    if (oc.tag === 'ok' || oc.tag === 'throw') fast.push(inputs[i]!);
    else if (oc.detail === 'timeout' || oc.detail.startsWith('not run')) slow++;
    else faults++;
  });
  return { fast, slow, faults };
}

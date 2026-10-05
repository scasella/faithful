/**
 * Adapted in part from scasella/undefined src/mutation/run.ts and classify.ts, MIT, (c) 2026 Stephen Casella; changes:
 * the runner is the engine's Sandbox (original and each mutant run on the same inputs, outcomes compared) instead of
 * an injected gate runner; outcomes are caught / caught-by-time-limit / not-distinguished / stillborn instead of
 * killed / killed-by-bound / survived / stillborn; a second pass over more and larger inputs separates likely
 * equivalent mutants from weak inputs; no time box (every drawn mutant is run). The bucket invariant (every drawn
 * mutant lands in exactly one bucket, checked by the report builder) is the reference's.
 *
 * mutationCheck answers "would the differential inputs notice a broken copy of this function?":
 *
 *  1. Up to `max` mutants ("broken copies") of the original are generated, seeded (mutate.ts).
 *  2. The original runs on the given inputs. Only inputs where its outcome is `ok` or `throw` form the comparison
 *     basis: a `fault` is never agreement, so it is never evidence either way. With `instrumentedTs`, inputs on which
 *     the range-instrumented original reports `range-violation` are outside the precondition and dropped too.
 *  3. Each mutant runs on the basis. It is CAUGHT when some input yields a different outcome (key-sorted canonical
 *     JSON of the Outcome). A mutant call that hits the time limit is retried once with a 5x budget; if it still times
 *     out and no other input differs, the mutant is `caught-by-time-limit`, reported separately and NOT counted in k.
 *  4. Mutants not caught by pass 1 run on a second pass of more, larger inputs (inputs.ts), filtered through `accept`
 *     (the precondition predicates), the instrumented original and the original's own faults. Caught there: counted
 *     as caught, tagged `pass: 2`. Not caught there either: `not-distinguished`, with N = valid inputs of both passes.
 *     They are reported ("not distinguished by N inputs"), never dropped and never counted as caught. They may be
 *     equivalent to the original; this tester does not decide that.
 *  5. A mutant the sandbox will not load is `stillborn`: not run, not in m.
 *
 * Headline: "k of m broken copies caught", m = mutants that ran = caught + caught-by-time-limit + not-distinguished.
 */
import type { Outcome, Val } from '@faithful/translate';
import { Sandbox } from '../sandbox/sandbox.js';
import type { CallResult } from '../sandbox/protocol.js';
import { mulberry32 } from '../benchmark/rng.js';
import { generateMutants, type MutationKind } from './mutate.js';
import { deriveInputs, paramTys } from './inputs.js';
import { formatCount } from '@faithful/core';

export interface MutationOptions {
  /** Seeds mutant selection and second-pass inputs. Same seed, same source, same inputs: same mutants and inputs. */
  seed: number;
  /** Mutants to draw at most. Default 12. */
  max?: number;
  /** Second-pass inputs to generate (before filtering). Default 1000. 0 disables the second pass. */
  secondPassInputs?: number;
  /**
   * The range-instrumented original (`Translation.instrumentedTs`). When given, inputs on which it reports
   * `range-violation` are outside the precondition and excluded from both passes.
   */
  instrumentedTs?: string;
  /** Precondition predicate (e.g. the `ts` expressions of the translation's preconditions). Rejected inputs are excluded. */
  accept?: (args: Val[]) => boolean;
  /** Per-call budget, ms. Default max(100, 20 x the original's slowest call on the given inputs). */
  perCallMs?: number;
  /** Use this sandbox instead of opening (and closing) a private one. */
  sandbox?: Sandbox;
  /** Value domain of every load (original and mutants), see `LoadOptions.values`. `'js'` for the Tested-only path. */
  values?: 'subset' | 'js';
}

export type MutantFate =
  | { status: 'caught'; pass: 1 | 2; input: Val[]; original: Outcome; mutant: Outcome }
  | { status: 'caught-by-time-limit'; pass: 1 | 2; input: Val[]; perCallMs: number }
  | { status: 'not-distinguished'; inputs: number }
  | { status: 'stillborn'; error: string };

export interface MutantResult {
  id: string;
  kind: MutationKind;
  line: number;
  column: number;
  original: string;
  mutated: string;
  fate: MutantFate;
}

export interface MutationReport {
  fnName: string;
  seed: number;
  /** k: mutants some input told apart from the original (passes 1 and 2). */
  caught: number;
  caughtFirstPass: number;
  caughtSecondPass: number;
  /** Mutants that only ever hit the time limit. Not in k. */
  caughtByTimeLimit: number;
  /** Mutants no input told apart. Not in k. */
  notDistinguished: number;
  /** m: mutants that ran. */
  total: number;
  /** Drawn mutants that did not parse or did not load. Not in m. */
  stillborn: number;
  /** Distinct candidate sites found in the function. */
  sites: number;
  inputs: {
    given: number;
    /** Given inputs in the comparison basis (original `ok`/`throw`, accepted, no range violation). */
    firstPass: number;
    secondPassGenerated: number;
    /** Why no second-pass inputs were generated, when none were. */
    secondPassSkipped: string | null;
    /** Second-pass inputs that survived filtering. */
    secondPass: number;
    excluded: { fault: number; rangeViolation: number; rejected: number };
  };
  perCallMs: number;
  mutants: MutantResult[];
  ms: number;
  /** ISO timestamp of the run. */
  at: string;
  node: string;
  /** "k of m broken copies caught" plus the non-zero side buckets. */
  summary: string;
}

export const DEFAULT_MAX_MUTANTS = 12;
export const DEFAULT_SECOND_PASS_INPUTS = 1000;

/** JSON with object keys sorted, so record field order never decides a comparison. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

const isTimeout = (o: Outcome): boolean => o.tag === 'fault' && (o.detail === 'timeout' || o.detail.startsWith('not run'));
const plural = (n: number, one: string, many: string): string => `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * Builds the counts and the summary from per-mutant results. Throws when the buckets do not account for every
 * mutant exactly once, so nothing can be dropped silently.
 */
export function summarize(results: MutantResult[], drawn: number): Pick<
  MutationReport,
  'caught' | 'caughtFirstPass' | 'caughtSecondPass' | 'caughtByTimeLimit' | 'notDistinguished' | 'total' | 'stillborn' | 'summary'
> {
  let c1 = 0;
  let c2 = 0;
  let bound = 0;
  let nd = 0;
  let still = 0;
  let ndInputs = 0;
  for (const r of results) {
    switch (r.fate.status) {
      case 'caught':
        if (r.fate.pass === 1) c1++;
        else c2++;
        break;
      case 'caught-by-time-limit':
        bound++;
        break;
      case 'not-distinguished':
        nd++;
        ndInputs = Math.max(ndInputs, r.fate.inputs);
        break;
      case 'stillborn':
        still++;
        break;
      default:
        throw new Error(`mutation report: unknown fate ${JSON.stringify(r.fate)}`);
    }
  }
  if (c1 + c2 + bound + nd + still !== drawn || results.length !== drawn) {
    throw new RangeError(`mutation report: ${results.length} results for ${drawn} drawn mutants do not add up`);
  }
  const caught = c1 + c2;
  const total = caught + bound + nd;
  const parts: string[] = [];
  if (bound > 0) parts.push(`${formatCount(bound)} more stopped only by the time limit`);
  if (nd > 0) parts.push(`${formatCount(nd)} not distinguished by ${plural(ndInputs, 'input', 'inputs')}`);
  if (still > 0) parts.push(`${formatCount(still)} did not load`);
  const head = total === 0 ? 'No broken copies could be run' : `${formatCount(caught)} of ${formatCount(total)} broken copies caught`;
  const summary = parts.length > 0 ? `${head} (${parts.join('; ')})` : head;
  return { caught, caughtFirstPass: c1, caughtSecondPass: c2, caughtByTimeLimit: bound, notDistinguished: nd, total, stillborn: still, summary };
}

let runCounter = 0;

interface Basis {
  inputs: Val[][];
  outcomes: Outcome[];
  /** Wall-clock time of the original's batch over these inputs. */
  ms: number;
}

export async function mutationCheck(source: string, fnName: string, inputs: Val[][], opts: MutationOptions): Promise<MutationReport> {
  const t0 = performance.now();
  const at = new Date().toISOString();
  const max = opts.max ?? DEFAULT_MAX_MUTANTS;
  const gen = generateMutants(source, fnName, { seed: opts.seed, max });
  const own = !opts.sandbox;
  const sb = opts.sandbox ?? (await Sandbox.open());
  const tag = `mut${++runCounter}`; // sandbox id namespace only
  const origId = `${tag}:orig`;
  const instId = `${tag}:inst`;
  const excluded = { fault: 0, rangeViolation: 0, rejected: 0 };

  try {
    const lo = await sb.load(origId, source, fnName, { values: opts.values });
    if (!lo.ok) throw new Error(`mutationCheck: the original does not load: ${lo.error}`);
    if (opts.instrumentedTs !== undefined) {
      const li = await sb.load(instId, opts.instrumentedTs, fnName, { instrumented: true, values: opts.values });
      if (!li.ok) throw new Error(`mutationCheck: the instrumented original does not load: ${li.error}`);
    }

    /** Original outcomes on `cands`, keeping only inputs inside the precondition where the original does not fault. */
    const basisOf = async (cands: Val[][], perCallMs: number | undefined): Promise<{ basis: Basis; maxMs: number }> => {
      let keep = cands.map(() => true);
      if (opts.accept) {
        keep = cands.map((a) => {
          let ok = false;
          try {
            ok = opts.accept!(a);
          } catch {
            ok = false;
          }
          if (!ok) excluded.rejected++;
          return ok;
        });
      }
      let idx = cands.map((_, i) => i).filter((i) => keep[i]);
      if (opts.instrumentedTs !== undefined) {
        const r = await sb.callBatch(instId, idx.map((i) => cands[i]!), perCallMs ? { perCallMs } : {});
        idx = idx.filter((_, j) => {
          const o = r.results[j]!.outcome;
          if (o.tag === 'range-violation') {
            excluded.rangeViolation++;
            return false;
          }
          return true;
        });
      }
      const r = await sb.callBatch(origId, idx.map((i) => cands[i]!), perCallMs ? { perCallMs } : {});
      const basis: Basis = { inputs: [], outcomes: [], ms: r.ms };
      let maxMs = 0;
      idx.forEach((i, j) => {
        const res = r.results[j]!;
        if (res.outcome.tag === 'fault' || res.outcome.tag === 'range-violation') {
          excluded.fault++;
          return;
        }
        maxMs = Math.max(maxMs, res.ms);
        basis.inputs.push(cands[i]!);
        basis.outcomes.push(res.outcome);
      });
      return { basis, maxMs };
    };

    const first = await basisOf(inputs, opts.perCallMs);
    const perCallMs = opts.perCallMs ?? Math.max(100, Math.ceil(20 * first.maxMs));

    // Second pass inputs: generated up front from the seed, so the set never depends on which mutants survived.
    let second: Basis | null = null;
    let secondGenerated = 0;
    let secondSkipped: string | null = null;
    const wantSecond = (opts.secondPassInputs ?? DEFAULT_SECOND_PASS_INPUTS) > 0;
    const getSecond = async (): Promise<Basis> => {
      if (second) return second;
      const tys = paramTys(source, fnName);
      const n = opts.secondPassInputs ?? DEFAULT_SECOND_PASS_INPUTS;
      if (!tys) secondSkipped = 'a parameter type is outside what the second-pass generator can draw';
      const cands = tys && wantSecond ? deriveInputs(tys, inputs, n, mulberry32((opts.seed ^ 0x5eed2) >>> 0)) : [];
      secondGenerated = cands.length;
      second = (await basisOf(cands, perCallMs)).basis;
      return second;
    };

    /** First input where the mutant's outcome differs, or a time-limit-only verdict, or null. */
    const distinguish = async (id: string, b: Basis): Promise<{ kind: 'diff'; i: number; o: Outcome } | { kind: 'bound'; i: number } | null> => {
      if (b.inputs.length === 0) return null;
      // A mutant that loops costs a worker respawn per input; cap the batch at ten times the original's batch time
      // (at least 2 s). Inputs left unrun count like timeouts: never as a difference.
      const r = await sb.callBatch(id, b.inputs, { perCallMs, totalMs: Math.max(2000, 10 * b.ms) + 3 * perCallMs });
      const timeouts: number[] = [];
      for (let i = 0; i < b.inputs.length; i++) {
        const o = (r.results[i] as CallResult).outcome;
        if (isTimeout(o)) {
          timeouts.push(i);
          continue;
        }
        if (canonicalJson(o) !== canonicalJson(b.outcomes[i])) return { kind: 'diff', i, o };
      }
      for (const i of timeouts.slice(0, 3)) {
        const o = (await sb.call(id, b.inputs[i]!, { timeoutMs: perCallMs * 5 })).outcome;
        if (!isTimeout(o) && canonicalJson(o) !== canonicalJson(b.outcomes[i])) return { kind: 'diff', i, o };
        if (isTimeout(o)) return { kind: 'bound', i };
      }
      return null;
    };

    const results: MutantResult[] = [];
    let k = 0;
    for (const m of gen.mutants) {
      const info = { id: m.id, kind: m.kind, line: m.line, column: m.column, original: m.original, mutated: m.mutated };
      const id = `${tag}:m${k++}`;
      const l = await sb.load(id, m.source, fnName, { values: opts.values });
      if (!l.ok) {
        results.push({ ...info, fate: { status: 'stillborn', error: l.error } });
        continue;
      }
      try {
        results.push({ ...info, fate: await fateOf(id) });
      } finally {
        await sb.unload(id);
      }
    }

    async function fateOf(id: string): Promise<MutantFate> {
      const b1 = first.basis;
      const d1 = await distinguish(id, b1);
      if (d1?.kind === 'diff') return { status: 'caught', pass: 1, input: b1.inputs[d1.i]!, original: b1.outcomes[d1.i]!, mutant: d1.o };
      let bound: MutantFate | null = d1?.kind === 'bound' ? { status: 'caught-by-time-limit', pass: 1, input: b1.inputs[d1.i]!, perCallMs } : null;
      if (!wantSecond) return bound ?? { status: 'not-distinguished', inputs: b1.inputs.length };
      const b2 = await getSecond();
      const d2 = await distinguish(id, b2);
      if (d2?.kind === 'diff') return { status: 'caught', pass: 2, input: b2.inputs[d2.i]!, original: b2.outcomes[d2.i]!, mutant: d2.o };
      if (!bound && d2?.kind === 'bound') bound = { status: 'caught-by-time-limit', pass: 2, input: b2.inputs[d2.i]!, perCallMs };
      return bound ?? { status: 'not-distinguished', inputs: b1.inputs.length + b2.inputs.length };
    }

    // Drawn mutants that failed prepareSource never reached the sandbox: recorded as stillborn, never dropped.
    for (const m of gen.stillbornMutants) results.push({ ...m, fate: { status: 'stillborn', error: 'mutated source does not parse' } });
    const drawn = gen.mutants.length + gen.stillbornMutants.length;

    const counts = summarize(results, drawn);
    const sec = second as Basis | null;
    return {
      fnName,
      seed: opts.seed,
      ...counts,
      sites: gen.sites,
      inputs: {
        given: inputs.length,
        firstPass: first.basis.inputs.length,
        secondPassGenerated: secondGenerated,
        secondPassSkipped: !wantSecond
          ? 'second pass disabled (secondPassInputs: 0)'
          : sec
            ? secondSkipped
            : 'not needed: no mutant got past the first pass',
        secondPass: sec ? sec.inputs.length : 0,
        excluded,
      },
      perCallMs,
      mutants: results,
      ms: Math.round(performance.now() - t0),
      at,
      node: process.version,
    };
  } finally {
    if (own) await sb.close();
    else {
      await sb.unload(origId).catch(() => undefined);
      if (opts.instrumentedTs !== undefined) await sb.unload(instId).catch(() => undefined);
    }
  }
}

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '@faithful/core';
import { translate, type Translation } from '@faithful/translate';
import { Sandbox, type LeanEvaluator } from '@faithful/engine';
import { CodexClient } from '@faithful/prover';
import type { ChallengeRun } from '@faithful/session';
import { challengeSearch } from './challenge.js';
import { makeCarveOut } from './carveout.js';
import { SessionRuntime } from './runtime.js';
import { runAutopilot } from './autopilot.js';

// The original always returns 0, so a fake Lean that prints {"tag":"ok","value":0} agrees with it everywhere.
const ZERO_TS = 'export function z(n: number): number {\n  return 0;\n}\n';
const OK = '{"tag":"ok","value":0}';
const SPEC = 'namespace Spec\ndef spec (n : Int) : Int := 0\nend Spec';

/** A scripted Lean: `answer` decides each expression's output (null = no output, as after a timeout). Records batch sizes. */
function fakeLean(answer: (expr: string, batchSize: number) => string | null): LeanEvaluator & { sizes: number[] } {
  const sizes: number[] = [];
  return {
    sizes,
    async evalBatch(_prelude, exprs) {
      sizes.push(exprs.length);
      return { outputs: exprs.map((e) => answer(e, exprs.length)), errors: new Map() };
    },
  };
}

/** Every generated input that satisfied the preconditions is accounted for exactly once. */
function accounted(run: Omit<ChallengeRun, 'id' | 'specHash'>): number {
  const x = run.excluded!;
  return x.carvedOut + x.range + x.faults + x.throwPrecondition + (x.specFaults ?? 0) + run.inputsCompared;
}

describe('challenge search: spec faults and carve-out counts (fake Lean, real sandbox)', () => {
  let sb: Sandbox;
  beforeAll(async () => { sb = await Sandbox.open(); });
  afterAll(async () => { await sb.close(); });
  const t = translate(ZERO_TS, 'z') as Translation;
  const search = (lean: LeanEvaluator, carveOuts = [] as ReturnType<typeof makeCarveOut>[]) =>
    challengeSearch(t, SPEC, { n: 120, seed: 7, throwChoice: null, carveOuts }, { lean, sandbox: sb });

  it('a spec that faults on some inputs: those are counted in specFaults, never listed as disagreements', async () => {
    // negative inputs never evaluate (even alone); everything else agrees
    const lean = fakeLean((e) => (e.includes('Spec.spec (-') ? null : OK));
    const r = await search(lean);
    expect(r.run.excluded.specFaults).toBeGreaterThan(0);
    expect(r.run.totalDisagreements).toBe(0);
    expect(r.run.disagreements).toEqual([]);
    expect(r.run.excluded.faults).toBe(0); // `faults` stays the ORIGINAL's faults
    expect(r.run.inputsCompared).toBeGreaterThan(0);
    expect(accounted(r.run)).toBe(r.run.excluded.generatedBeforeCarveOuts);
  });

  it('retries spec faults in small batches: a batch-level timeout is recovered', async () => {
    // any batch larger than 10 dies as a unit (no output for any line); small batches evaluate fine
    const lean = fakeLean((_e, size) => (size > 10 ? null : OK));
    const r = await search(lean);
    expect(r.run.excluded.specFaults).toBe(0);
    expect(r.run.totalDisagreements).toBe(0);
    expect(r.run.inputsCompared).toBe(r.run.excluded.generatedBeforeCarveOuts);
    expect(lean.sizes[0]).toBe(100);
    expect(lean.sizes.slice(2).every((s) => s <= 10)).toBe(true);
  });

  it('counts carved-out inputs out of the inputs generated before the carve-outs, and keeps the compared count up', async () => {
    const lean = fakeLean(() => OK);
    const carve = makeCarveOut(t, [-3], { param: 0, kind: 'negative' });
    const r = await search(lean, [carve]);
    const x = r.run.excluded;
    expect(x.carvedOut).toBeGreaterThan(0);
    expect(x.generatedBeforeCarveOuts).toBeGreaterThan(x.carvedOut);
    expect(accounted(r.run)).toBe(x.generatedBeforeCarveOuts);
    // generation scaled up: about n inputs remain to compare, not about n/2
    expect(r.run.inputsCompared).toBeGreaterThanOrEqual(100);
    expect(r.run.carveOutIds).toEqual([carve.id]);
    // without carve-outs nothing is carved
    const plain = await search(lean);
    expect(plain.run.excluded.carvedOut).toBe(0);
    expect(plain.run.excluded.generatedBeforeCarveOuts).toBe(plain.run.inputsCompared);
  });

  it('one slow input does not hide a disagreement among the inputs batched with it', async () => {
    // a batch holding any input with 4+ digits runs until its budget and prints nothing; otherwise the spec is 0, except
    // 1 at n = 7 (a real disagreement with the original, which always returns 0)
    const sizes: number[] = [];
    const lean: LeanEvaluator = {
      async evalBatch(_prelude, exprs, opts) {
        sizes.push(exprs.length);
        const ns = exprs.map((e) => Number(/Spec\.spec \(?(-?\d+)/.exec(e)![1]));
        if (ns.some((n) => Math.abs(n) >= 1000)) {
          await new Promise((r) => setTimeout(r, opts.budgetMs));
          return { outputs: exprs.map(() => null), errors: new Map() };
        }
        return { outputs: ns.map((n) => (n === 7 ? '{"tag":"ok","value":1}' : OK)), errors: new Map() };
      },
    };
    const r = await challengeSearch(t, SPEC, { n: 400, seed: 7, throwChoice: null, carveOuts: [], leanBudgetMs: 150 }, { lean, sandbox: sb });
    expect(sizes.slice(0, 4)).toEqual([100, 100, 100, 100]);
    expect(r.run.totalDisagreements).toBe(1);
    expect(r.run.disagreements[0]!.input).toEqual([7]);
    // every input is compared or counted as a spec fault
    expect(r.run.inputsCompared + r.run.excluded.specFaults).toBe(r.run.excluded.generatedBeforeCarveOuts);
    // most inputs never evaluate here, so agreeBlocker would refuse this run (specFaults >= inputsCompared)
    expect(r.run.excluded.specFaults).toBeGreaterThanOrEqual(r.run.inputsCompared);
  }, 30_000);

  it('a spec that never evaluates leaves nothing compared and no disagreement', async () => {
    const r = await search(fakeLean(() => null));
    expect(r.run.inputsCompared).toBe(0);
    expect(r.run.totalDisagreements).toBe(0);
    expect(r.run.excluded.specFaults).toBe(r.run.excluded.generatedBeforeCarveOuts);
  }, 30_000);
});

const runOf = (specHash: string, over: Partial<ChallengeRun>): ChallengeRun => ({
  id: 1, specHash, inputsTried: 400, inputsCompared: 0, disagreements: [], totalDisagreements: 0, ms: 1, seed: 1, carveOutIds: [],
  excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0, specFaults: 0, generatedBeforeCarveOuts: 400 },
  ...over,
});

describe('agreeBlocker: a search that compared nothing (or fewer inputs than its spec faults) is not a clean run', () => {
  it('blocks with its own reason, and does not block a clean run', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'faithful-repo-'));
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: '/bin/false' }) });
    try {
      await rt.pasteFunction(ZERO_TS, 'z');
      const hash = 'sha256:' + '0'.repeat(64);
      await rt.emit({ kind: 'spec.proposed', proposal: { id: 1, kind: 'proposal', lean: SPEC, lines: [], properties: [], english: 'zero', callId: null, validation: { ok: true, hash } } });
      await rt.emit({ kind: 'challenge.run', run: runOf(hash, { excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0, specFaults: 400, generatedBeforeCarveOuts: 400 } }) });
      expect(rt.agreeBlocker()).toMatch(/^Lean could not evaluate the spec on any compared input; 400 inputs/);
      await expect(rt.agree()).rejects.toThrow(/could not evaluate the spec/);
      await rt.emit({ kind: 'challenge.run', run: runOf(hash, { id: 2, inputsCompared: 390, excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0, specFaults: 10, generatedBeforeCarveOuts: 400 } }) });
      expect(rt.agreeBlocker()).toBeNull();
      // more spec faults than compared inputs: blocked, even with no disagreement found
      await rt.emit({ kind: 'challenge.run', run: runOf(hash, { id: 3, inputsCompared: 10, excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0, specFaults: 390, generatedBeforeCarveOuts: 400 } }) });
      expect(rt.agreeBlocker()).toMatch(/^Lean could not evaluate the spec on 390 inputs \(timeout or crash\), at least as many as the 10 it compared/);
      await rt.emit({ kind: 'challenge.run', run: runOf(hash, { id: 4, inputsCompared: 200, excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0, specFaults: 200, generatedBeforeCarveOuts: 400 } }) });
      expect(rt.agreeBlocker()).toMatch(/at least as many as the 200 it compared/);
    } finally {
      await rt.close();
    }
  });
});

describe('autopilot: a carve-out that takes half the inputs blocks at agreement', () => {
  it('does not agree, and says why on the carve-out ruling', async () => {
    const t = translate(ZERO_TS, 'z') as Translation;
    const hash = 'sha256:' + '1'.repeat(64);
    const d = { id: 'c1', input: [5], spec: { tag: 'ok' as const, value: 1 }, original: { tag: 'ok' as const, value: 0 }, origin: 'random' as const };
    const state = {
      translation: { ok: true, value: t },
      proposals: [{ id: 1 }],
      challengeRuns: [runOf(hash, { inputsCompared: 400, disagreements: [d], totalDisagreements: 1 })],
      optimize: { candidates: [], incumbentId: null, stoppedBy: null },
    };
    let agreed = false;
    const rt = {
      state,
      codex: { calls: [], model: 'fake' },
      async openFunction() {},
      needsThrowChoice: () => false,
      proposeSpec: async () => ({ validation: { ok: true, hash } }),
      agreeBlocker: () => (state.challengeRuns.at(-1)!.totalDisagreements ? '1 disagreement remains' : null),
      carveOptionsFor: () => [{ cls: { param: 0, kind: 'positive' }, excluded: 'inputs where n is positive' }],
      async rule() {
        // the re-run under the carve-out: clean, but the carve-out took 210 of 400 generated inputs
        state.challengeRuns.push(runOf(hash, { id: 2, inputsCompared: 190, excluded: { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 210, specFaults: 0, generatedBeforeCarveOuts: 400 } }));
      },
      async agree() { agreed = true; },
    };
    const { result } = await runAutopilot({
      file: 'z.ts', fn: 'z', repoRoot: '/nonexistent', minutes: 0, proofAttempts: 0, proofMinutes: 0, optimize: false,
      policy: { maxRevisions: 0 }, runtime: rt as unknown as SessionRuntime,
    });
    expect(result.error).toBeNull();
    expect(agreed).toBe(false);
    expect(result.blockedAt).toBe('agreement');
    expect(result.bestTier).toBe('blocked');
    expect(result.rulings).toHaveLength(1);
    expect(result.rulings[0]!.note).toMatch(/BLOCKED: the carve-outs exclude 210 of 400 generated inputs/);
  });
});

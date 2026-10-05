/**
 * Autopilot: a scripted USER for measurement runs and recorded sessions. Everything else is the real tool (real Codex, real
 * Lean, real Z3, real sandbox). The policy for the user's decisions is explicit and recorded in the result, because a
 * measurement is only honest if it says who made which ruling:
 *   - throw sites: modeled as a precondition (policy.throwChoice)
 *   - a disagreement: first "the spec is wrong" (revise) up to `maxRevisions` times; after that, if a carve-out class exists
 *     (the first class offered, negative/empty/etc.), carve it out; otherwise the session is BLOCKED at agreement (reported).
 *   - Agree: yes, once no disagreement remains.
 *   - faster-but-not-proved candidates: never accepted (policy.acceptVerified = false by default).
 */
import { performance } from 'node:perf_hooks';
import { summarizeCalls } from '@faithful/prover';
import type { Tier } from '@faithful/core';
import { SessionRuntime } from './runtime.js';
import { Optimizer } from './optimize.js';
import { deliver } from './deliver.js';

export interface AutopilotPolicy {
  throwChoice: 'precondition' | 'spec-case';
  maxRevisions: number;
  acceptVerified: boolean;
}

export const DEFAULT_POLICY: AutopilotPolicy = { throwChoice: 'precondition', maxRevisions: 2, acceptVerified: false };

export interface AutopilotOptions {
  file: string;
  fn: string;
  repoRoot: string;
  minutes: number;
  proofAttempts: number;
  proofMinutes: number;
  policy?: Partial<AutopilotPolicy>;
  optimize?: boolean;
  runtime?: SessionRuntime;
  log?: (s: string) => void;
}

export interface AutopilotResult {
  fn: string;
  file: string;
  inSubset: boolean;
  refusal: { code: string; reason: string } | null;
  specProposals: number;
  disagreementsFound: number;
  rulings: Array<{ ruling: string; then?: string; note?: string }>;
  blockedAt: 'agreement' | null;
  agreed: boolean;
  originalProof: { result: string; attempts: number; minutes: number } | null;
  candidates: Array<{ id: number; outcome: string; tier: Tier | null; speedup: { ratio: number; lo: number; hi: number } | null; rejection: string | null; rejectionStage: string | null }>;
  bestTier: Tier | 'refused' | 'blocked' | 'none';
  bestSpeedup: { ratio: number; lo: number; hi: number } | null;
  fasterNotProved: number;
  stoppedBy: string | null;
  wallMs: number;
  codex: { calls: number; failed: number; inputTokens: number; outputTokens: number; ms: number };
  policy: AutopilotPolicy;
  stamp: { date: string; modelId: string };
  error: string | null;
}

export async function runAutopilot(o: AutopilotOptions): Promise<{ result: AutopilotResult; runtime: SessionRuntime }> {
  const policy: AutopilotPolicy = { ...DEFAULT_POLICY, ...o.policy };
  const log = o.log ?? (() => {});
  const rt = o.runtime ?? new SessionRuntime({ repoRoot: o.repoRoot });
  const t0 = performance.now();
  const res: AutopilotResult = {
    fn: o.fn, file: o.file, inSubset: false, refusal: null, specProposals: 0, disagreementsFound: 0, rulings: [], blockedAt: null, agreed: false,
    originalProof: null, candidates: [], bestTier: 'none', bestSpeedup: null, fasterNotProved: 0, stoppedBy: null, wallMs: 0,
    codex: { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, ms: 0 }, policy, stamp: { date: new Date().toISOString().slice(0, 10), modelId: '' }, error: null,
  };
  const finish = () => {
    res.wallMs = performance.now() - t0;
    const sc = summarizeCalls(rt.codex.calls);
    res.codex = { calls: sc.calls, failed: sc.failed, inputTokens: sc.inputTokens, outputTokens: sc.outputTokens, ms: sc.ms };
    res.stamp.modelId = rt.codex.model;
    res.specProposals = rt.state.proposals.length;
    res.candidates = rt.state.optimize.candidates.map((c) => ({
      id: c.id, outcome: c.outcome, tier: c.tier, speedup: c.speedup ? { ratio: c.speedup.ratio, lo: c.speedup.lo, hi: c.speedup.hi } : null,
      rejection: c.rejection?.reason ?? null, rejectionStage: c.rejection?.stage ?? null,
    }));
    res.fasterNotProved = res.candidates.filter((c) => c.outcome === 'faster-not-proved').length;
    const inc = rt.state.optimize.candidates.find((c) => c.id === rt.state.optimize.incumbentId);
    if (inc) {
      res.bestTier = inc.tier ?? 'tested';
      res.bestSpeedup = inc.speedup ? { ratio: inc.speedup.ratio, lo: inc.speedup.lo, hi: inc.speedup.hi } : null;
    } else if (res.inSubset && res.originalProof?.result && res.originalProof.result !== 'not-proved') res.bestTier = res.originalProof.result as Tier;
    res.stoppedBy = rt.state.optimize.stoppedBy;
  };
  try {
    await rt.openFunction(o.file, o.fn);
    const tr = rt.state.translation;
    if (!tr || !tr.ok) {
      res.refusal = tr && !tr.ok ? { code: tr.refusal.code, reason: tr.refusal.reason } : null;
      res.bestTier = 'refused';
      finish();
      return { result: res, runtime: rt };
    }
    res.inSubset = true;
    if (rt.needsThrowChoice()) await rt.chooseThrow(policy.throwChoice);
    log('proposing spec');
    let prop = await rt.proposeSpec();
    let revisions = 0;
    for (let guard = 0; guard < 8; guard++) {
      if (!prop.validation.ok) {
        // a spec that does not compile is not a user ruling: ask again (counted in specProposals)
        if (guard >= 3) break;
        prop = await rt.proposeSpec();
        continue;
      }
      const blocker = rt.agreeBlocker();
      if (!blocker) break;
      const run = rt.state.challengeRuns.at(-1);
      const d = run?.disagreements[0];
      if (!d) break;
      res.disagreementsFound = Math.max(res.disagreementsFound, run!.totalDisagreements ?? run!.disagreements.length);
      if (revisions < policy.maxRevisions) {
        revisions++;
        await rt.rule({ challengeId: d.id, ruling: 'spec-wrong' });
        res.rulings.push({ ruling: 'spec-wrong' });
        prop = await rt.reviseSpec();
      } else {
        const opts = rt.carveOptionsFor(d.id).filter((c) => c.cls.kind !== 'exact-input');
        if (!opts.length) break;
        await rt.rule({ challengeId: d.id, ruling: 'function-wrong', then: 'carve-out', carve: opts[0]!.cls });
        res.rulings.push({ ruling: 'function-wrong', then: 'carve-out', note: opts[0]!.excluded });
      }
    }
    if (rt.agreeBlocker()) {
      res.blockedAt = 'agreement';
      res.bestTier = 'blocked';
      finish();
      return { result: res, runtime: rt };
    }
    await rt.agree();
    res.agreed = true;
    log('proving original');
    const pv = await rt.proveOriginal({ maxAttempts: o.proofAttempts, minutes: o.proofMinutes });
    res.originalProof = { result: pv.result, attempts: pv.attempts.length, minutes: pv.ms / 60_000 };
    if (o.optimize !== false) {
      log('optimizing');
      const opt = new Optimizer(rt, { threshold: { kind: 'time-budget', minutes: o.minutes } });
      await opt.run();
      if (policy.acceptVerified) {
        for (const c of rt.state.optimize.candidates.filter((x) => x.outcome === 'faster-not-proved' && x.tier === 'verified-to-k')) await opt.acceptFasterNotProved(c.id);
      }
    }
    await deliver(rt);
  } catch (e) {
    res.error = (e as Error).message;
  }
  finish();
  return { result: res, runtime: rt };
}

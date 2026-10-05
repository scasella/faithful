/**
 * provenance.json: the record a reviewer re-checks. One claim per entry, each with its exact tier and what it rests on.
 * `faithful verify` recomputes every hash and re-runs the proofs, the differential test and the SMT check.
 */
import type { Stamp, Tier } from '@faithful/core';
import type { Precondition } from '@faithful/translate';
import type { BenchSummary, Rejection, Ruling, Speedup } from './types.js';

export type ClaimKind =
  | 'original-meets-spec' // Lean theorem: original = spec under the preconditions
  | 'candidate-meets-spec' // Lean theorem: candidate (modeled) = spec under the preconditions
  | 'candidate-vs-original-smt' // bounded Z3 equivalence
  | 'candidate-vs-original-differential'; // generated inputs + mutation check

export interface Claim {
  kind: ClaimKind;
  tier: Tier;
  /** What this claim is about, in plain words. */
  statement: string;
  /** Lean theorem name for proof claims. */
  theorem?: string;
  axioms?: string[];
  /** Smt: the bounds. Tested: counts. */
  k?: number;
  bounds?: { array: number; string: number; int: number };
  inputs?: number;
  seed?: number;
  mutation?: { caught: number; total: number; undistinguished: number };
  attempts?: number;
  minutes?: number;
  /** Set when the claim rests on a user decision, e.g. a faster-but-not-proved candidate accepted at Verified to k. */
  acceptedByUser?: boolean;
}

export interface CandidateHistoryEntry {
  id: number;
  round: number;
  sourceHash: string;
  outcome: string;
  tier: Tier | null;
  rejection: Rejection | null;
  speedup: Speedup | null;
}

export interface Provenance {
  schema: 1;
  fn: string;
  file: string;
  generatedAt: string;
  stamp: Stamp;
  /** The highest tier the delivered function reached against the agreed spec (proof, else bounded SMT, else tested). Caveats list anything that qualifies it. */
  deliveredTier: Tier;
  hashes: {
    originalSource: string;
    optimizedSource: string;
    patch: string;
    leanFile: string;
    model: string;
    spec: string;
    agreement: string;
  };
  /** The function text as translated, for display. */
  originalSource: string;
  /** The whole translation unit handed to the translator (verify re-translates from THIS, not from the user's file; line numbers in the model depend on it). */
  originalFileSource: string;
  optimizedSource: string;
  preconditions: Precondition[];
  carveOuts: Precondition[];
  rulings: Ruling[];
  claims: Claim[];
  benchmark: {
    baseline: BenchSummary | null;
    incumbent: BenchSummary | null;
    speedup: Speedup | null;
    distribution: string;
    sizes: number[];
  } | null;
  candidates: CandidateHistoryEntry[];
  codex: { calls: number; failed: number; model: string; effort: string; version: string | null };
  /** Plain-words caveats a reviewer must see (e.g. carve-outs exist; accepted below Proved). */
  caveats: string[];
}

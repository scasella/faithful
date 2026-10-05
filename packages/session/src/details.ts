/**
 * Typed shapes carried in `StageResult.detail` (kept as Record<string, unknown> in the event contract so recordings
 * from older versions replay). Writers use the `make*` helpers; readers (evidence line, provenance, UI) use the guards.
 */
import type { Z3Info } from '@faithful/core';

export interface DifferentialDetail {
  stage: 'differential';
  /** Inputs generated, and how many satisfied the preconditions and were compared. */
  generated: number;
  compared: number;
  seed: number;
  /** Broken copies of the ORIGINAL caught by these inputs (the mutation check). `undistinguished` are never counted as caught. */
  mutation?: { caught: number; total: number; undistinguished: number; seed: number };
}

export interface SmtDetail {
  stage: 'smt';
  /** Sequence bound for arrays and strings, integer bound, the largest k actually checked, and the budget it adapted within. */
  k: number;
  bounds: { array: number; string: number; int: number };
  budgetMs: number;
  z3: Z3Info;
  /** Result at that k: unsat = no distinguishing input up to k under the encoding. */
  result: 'unsat' | 'sat' | 'unknown' | 'timeout' | 'unsupported' | 'inconclusive';
  encoding: string;
}

export interface ProofDetail {
  stage: 'proof';
  theoremId: string;
  /** Which statement was proved: against the agreed spec (the normal case) or directly against the original. */
  against: 'spec' | 'original';
  axioms: string[];
  attempts: number;
}

export type StageDetail = DifferentialDetail | SmtDetail | ProofDetail;

export function isDifferentialDetail(d: unknown): d is DifferentialDetail {
  return !!d && typeof d === 'object' && (d as { stage?: unknown }).stage === 'differential';
}
export function isSmtDetail(d: unknown): d is SmtDetail {
  return !!d && typeof d === 'object' && (d as { stage?: unknown }).stage === 'smt';
}
export function isProofDetail(d: unknown): d is ProofDetail {
  return !!d && typeof d === 'object' && (d as { stage?: unknown }).stage === 'proof';
}

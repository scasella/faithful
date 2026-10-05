/**
 * Provenance: every reported number carries a `Stamp` (date, model id, toolchain versions; @faithful/core). These types
 * attach one to the engine's reports; `stamped` is the only constructor, so a stamped report always has one.
 */
import type { Stamp } from '@faithful/core';
import type { MutationReport } from '../mutation/check.js';
import type { BenchReport, CompareReport, SweepReport } from '../benchmark/bench.js';
import type { EvidenceBlock } from './evidence.js';

export type Stamped<T> = T & { readonly stamp: Stamp };

export type StampedMutationReport = Stamped<MutationReport>;
export type StampedBenchReport = Stamped<BenchReport>;
export type StampedCompareReport = Stamped<CompareReport>;
export type StampedSweepReport = Stamped<SweepReport>;
/** An evidence block already carries its stamp. */
export type StampedEvidence = EvidenceBlock;

export function stamped<T extends object>(value: T, stamp: Stamp): Stamped<T> {
  if (!stamp || typeof stamp.date !== 'string' || !stamp.toolchain) throw new Error('stamped: a Stamp with a date and a toolchain snapshot is required');
  return { ...value, stamp };
}

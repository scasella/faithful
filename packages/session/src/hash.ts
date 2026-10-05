import { hashOf } from '@faithful/core';
import type { Agreement } from './types.js';

/** Node-only (uses node:crypto). The hash an agreement pins downstream work to: spec + preconditions + carve-outs + rulings + throw choice. */
export function agreementHash(a: Pick<Agreement, 'specLean' | 'preconditions' | 'carveOuts' | 'rulings' | 'throwChoice'>): string {
  return hashOf({ s: a.specLean, p: a.preconditions, c: a.carveOuts, r: a.rulings, t: a.throwChoice });
}

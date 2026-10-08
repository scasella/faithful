/**
 * Seeded randomness shared by the benchmark (bootstrap resampling, input generation) and the mutation tester (mutant
 * selection, second-pass inputs). mulberry32: small, fast, deterministic; NOT cryptographic.
 *
 * `mulberry32` and `shuffle` are adapted from `prng` and `shuffle` in scasella/undefined
 * packages/engine/src/mutation/mutate.ts (MIT, (c) 2026 Stephen Casella).
 */
export type Rng = () => number;

/** A deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer uniformly drawn from [lo, hi] (inclusive). */
export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

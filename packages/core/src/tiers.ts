/**
 * The vocabulary of every claim. Labels are exact; there are no scores, grades or percentages.
 * docs/TIERS.md states the meaning and the non-meaning of each.
 */
export type Tier = 'proved' | 'proved-trusting-compiler' | 'verified-to-k' | 'tested' | 'not-proved';

export const TIER_LABEL: Record<Tier, string> = {
  proved: 'Proved',
  'proved-trusting-compiler': 'Proved (trusting the compiler)',
  'verified-to-k': 'Verified to k',
  tested: 'Tested',
  'not-proved': 'Not proved',
};

/** Strongest claim first. `not-proved` is the absence of a claim, ranked last. */
export const TIER_ORDER: Tier[] = ['proved', 'proved-trusting-compiler', 'verified-to-k', 'tested', 'not-proved'];

export function tierRank(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}

export function weakerOf(a: Tier, b: Tier): Tier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

/** Axioms Lean may report for a theorem to count as "Proved". */
export const ALLOWED_AXIOMS = ['propext', 'Classical.choice', 'Quot.sound'] as const;
/**
 * Axioms that downgrade a proof to "Proved (trusting the compiler)": `Lean.ofReduceBool` (older Lean) and, in Lean 4.34,
 * the per-use axiom `<thm>._native.native_decide.ax_<n>_<m>` that `native_decide` introduces.
 */
export const COMPILER_TRUST_AXIOMS = ['Lean.ofReduceBool', 'Lean.trustCompiler'] as const;
const NATIVE_AXIOM = /\._native\.[A-Za-z_]+\.ax_\d+(?:_\d+)*$/;

export function isCompilerTrustAxiom(a: string): boolean {
  return (COMPILER_TRUST_AXIOMS as readonly string[]).includes(a) || NATIVE_AXIOM.test(a);
}

/**
 * Classify the axioms `#print axioms` reported. Returns null when the set contains anything else
 * (including `sorryAx`): that is not a proof.
 */
export function tierFromAxioms(axioms: readonly string[]): 'proved' | 'proved-trusting-compiler' | null {
  let trusting = false;
  for (const a of axioms) {
    if ((ALLOWED_AXIOMS as readonly string[]).includes(a)) continue;
    if (isCompilerTrustAxiom(a)) {
      trusting = true;
      continue;
    }
    return null;
  }
  return trusting ? 'proved-trusting-compiler' : 'proved';
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** The sentence that must appear wherever "Proved" appears. */
export function provedSentence(nInputs: number): string {
  return (
    'Proved for the Lean model of this function. The model is produced by a fixed translator ' +
    `(docs/TRANSLATOR.md) and checked against the TypeScript on ${formatCount(nInputs)} inputs.`
  );
}

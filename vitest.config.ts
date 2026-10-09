import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The heavy suites: red-team and corpus runs that evaluate hundreds of generated programs in the sandbox, Lean or Z3.
 * Ten of them take 100 to 440 seconds each on an Apple M4 Pro with 14 cores (2026-10-09, Node v22.23.3, Lean 4.34.0) and
 * together with the two others (see their comments) they are most of the 3,292 seconds of test time of the whole suite
 * (all 76 files, 3,807 tests passed in 473 seconds of wall time). `pnpm test` runs all of them. With
 * FAITHFUL_FAST=1 they are left out, which is what the per-push CI jobs do: on a shared GitHub-hosted runner their Z3
 * queries exceed the fixed 120 s budgets the tests set, so they cannot give a reliable verdict there. They are meant to
 * be run on a local machine before a change to the translator, the SMT encoding or the sandbox (CONTRIBUTING.md), and
 * by hand in the "heavy" workflow.
 */
export const HEAVY_SUITES = [
  'packages/engine/src/redteam-strings.test.ts',
  'packages/engine/src/redteam-arrays.test.ts',
  'packages/engine/src/redteam-control.test.ts',
  'packages/engine/src/redteam-arithmetic.test.ts',
  'packages/engine/src/corpus.test.ts',
  'packages/smt/src/redteam-arrays.test.ts',
  'packages/smt/src/redteam-arith-control.test.ts',
  'packages/smt/src/redteam-strings-decode.test.ts',
  'packages/smt/src/sanity.test.ts',
  // 28 s on the Mac, but Z3 timed out in it on the hosted runner (2026-10-09)
  'packages/smt/src/library.test.ts',
  'packages/cli/src/flow/candidateProof.test.ts',
  // measures wall-clock time and needs a quiet machine: for two identical functions it asserts that a 95% interval
  // contains 1, which chance alone breaks now and then (once in two local fast runs: upper bound 0.9978)
  'packages/engine/src/benchmark/benchmark.test.ts',
];

export default defineConfig({
  resolve: {
    alias: {
      '@faithful/core/tiers': r('./packages/core/src/tiers.ts'),
      '@faithful/session/node': r('./packages/session/src/hash.ts'),
      '@faithful/core': r('./packages/core/src/index.ts'),
      '@faithful/translate': r('./packages/translate/src/index.ts'),
      '@faithful/engine': r('./packages/engine/src/index.ts'),
      '@faithful/smt': r('./packages/smt/src/index.ts'),
      '@faithful/session': r('./packages/session/src/index.ts'),
      '@faithful/prover': r('./packages/prover/src/index.ts'),
      // the showcase imports the UI's sources as @ui/... (apps/showcase/vite.config.ts)
      '@ui': r('./apps/ui/src'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    exclude: process.env.FAITHFUL_FAST ? [...configDefaults.exclude, ...HEAVY_SUITES] : configDefaults.exclude,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

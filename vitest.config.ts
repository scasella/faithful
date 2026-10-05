import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@faithful/core': r('./packages/core/src/index.ts'),
      '@faithful/translate': r('./packages/translate/src/index.ts'),
      '@faithful/engine': r('./packages/engine/src/index.ts'),
      '@faithful/smt': r('./packages/smt/src/index.ts'),
      '@faithful/prover': r('./packages/prover/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

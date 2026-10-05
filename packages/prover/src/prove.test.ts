import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig, resolveLeanDir } from '@faithful/core';
import { CodexClient } from './codex.js';
import { buildProofPrompt, failureLine, proveTheorem } from './prove.js';
import type { ProofTarget } from './proofFile.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;

const target: ProofTarget = {
  modelSource: 'namespace Model\ndef original (x : Int) : Int := x + x\ndef pre (x : Int) : Bool := decide (-100 ≤ x ∧ x ≤ 100)\nend Model\n',
  specSource: 'namespace Spec\ndef spec (x : Int) : Int := 2 * x\nend Spec\n',
  theoremName: 'original_meets_spec',
  statement: '∀ (x : Int), Model.pre x = true → Model.original x = Spec.spec x',
  tacticImports: [],
};

/** Fake codex that answers from a queue of canned JSON bodies, one per invocation (counter file). */
async function scripted(answers: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-codex-'));
  const counter = join(dir, 'n');
  await writeFile(counter, '0');
  for (let i = 0; i < answers.length; i++) await writeFile(join(dir, `a${i}.json`), JSON.stringify(answers[i]));
  await writeFile(join(dir, 'prompt-log'), '');
  const p = join(dir, 'codex');
  await writeFile(
    p,
    `#!/bin/sh\nOUT=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && OUT="$2"; shift; done\nN=$(cat ${counter}); echo $((N+1)) > ${counter}\ncat >> ${join(dir, 'prompt-log')}\ncp ${dir}/a$N.json "$OUT"\n`,
  );
  await chmod(p, 0o755);
  return p;
}

describe('proof prompt', () => {
  it('contains the file and, on retry, the diagnostics with goal states', () => {
    const p = buildProofPrompt(target, [
      {
        n: 1,
        call: {} as never,
        attempt: { helpers: '', proof: 'by skip' },
        check: { verdict: { status: 'failed', reason: 'compile-error' }, built: null, check: null, source: null, diagnostics: [{ file: 'f', line: 9, column: 2, endLine: 9, endColumn: 6, severity: 'error', message: 'unsolved goals\nx : Int\n⊢ x + x = 2 * x', kind: 'k', goal: 'x : Int\n⊢ x + x = 2 * x' }] },
        ms: 1,
      },
    ]);
    expect(p).toContain('<YOUR PROOF GOES HERE>');
    expect(p).toContain('def spec (x : Int) : Int := 2 * x');
    expect(p).toContain('⊢ x + x = 2 * x');
    expect(p).toContain('by skip');
  });
});

describe.skipIf(!hasLean)('proveTheorem with a scripted model and real Lean', () => {
  it('retries after a failed proof and stops when proved', async () => {
    const bin = await scripted([
      { helpers: '', proof: 'by\n  intro x _\n  skip', reasoning: 'wrong' },
      { helpers: '', proof: 'by\n  intro x _\n  simp [Model.original, Spec.spec]\n  omega', reasoning: 'unfold and omega' },
    ]);
    const codex = new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 20_000 });
    const rec = await proveTheorem(codex, target, { maxAttempts: 4, budgetMs: 120_000, checkBudgetMs: 60_000 });
    expect(rec.result).toBe('proved');
    expect(rec.attempts.length).toBe(2);
    expect(rec.attempts[1]!.call.prompt).toContain('⊢');
    expect(rec.stoppedBy).toBe('proved');
  });
  it('reports a failed proof as failed with its attempts and last goal state', async () => {
    const bad = { helpers: '', proof: 'by\n  intro x _\n  skip', reasoning: 'x' };
    const bin = await scripted([bad, bad]);
    const codex = new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 20_000 });
    const rec = await proveTheorem(codex, target, { maxAttempts: 2, budgetMs: 120_000, checkBudgetMs: 60_000 });
    expect(rec.result).toBe('not-proved');
    expect(rec.stoppedBy).toBe('attempts');
    expect(failureLine(rec)).toMatch(/^Not proved \(2 attempts, /);
    expect(rec.lastDiagnostics[0]?.goal).toContain('⊢');
  });
});

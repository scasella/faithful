import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig, resolveLeanDir } from '@faithful/core';
import { CodexClient } from './codex.js';
import { DEFAULT_PROOF_EFFORT, PROOF_GUIDE, buildProofPrompt, effortFor, failureLine, inductionPrinciples, locateInAttempt, parseEffortPolicy, proofEffortPolicy, proofGuideDefault, proveTheorem } from './prove.js';
import { buildProofFile, checkProof } from './proofFile.js';
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

describe('proof effort policy', () => {
  it('uses the last entry for later attempts', () => {
    expect(['low', 'medium', 'high'].map((_, i) => effortFor(['low', 'medium'], i + 1))).toEqual(['low', 'medium', 'medium']);
    expect(effortFor([], 1)).toBeUndefined();
  });
  it('parses a comma list and refuses unknown levels', () => {
    expect(parseEffortPolicy('low, medium,high')).toEqual(['low', 'medium', 'high']);
    expect(parseEffortPolicy('low,turbo')).toBeNull();
    expect(parseEffortPolicy('')).toBeNull();
  });
  it('FAITHFUL_PROOF_EFFORT wins, then FAITHFUL_EFFORT for every attempt, then the default', () => {
    expect(proofEffortPolicy({ FAITHFUL_PROOF_EFFORT: 'medium,high', FAITHFUL_EFFORT: 'low' })).toEqual(['medium', 'high']);
    expect(proofEffortPolicy({ FAITHFUL_EFFORT: 'high' })).toEqual(['high']);
    expect(proofEffortPolicy({})).toEqual(['high']);
    expect(DEFAULT_PROOF_EFFORT).toEqual(['high']);
    expect(proofEffortPolicy({ FAITHFUL_PROOF_EFFORT: 'bogus', FAITHFUL_EFFORT: 'medium' })).toEqual(['medium']);
  });
  it('the guide is on unless FAITHFUL_PROOF_GUIDE=0', () => {
    expect(proofGuideDefault({})).toBe(true);
    expect(proofGuideDefault({ FAITHFUL_PROOF_GUIDE: '0' })).toBe(false);
  });
});

describe('guided proof prompt', () => {
  const attempt = { helpers: 'theorem h1 : True := trivial', proof: 'by\n  intro x _\n  skip' };
  const built = buildProofFile(target, attempt);
  const failLine = built.theoremLine + 3;
  const history = [
    {
      n: 1,
      call: {} as never,
      attempt,
      check: { verdict: { status: 'failed' as const, reason: 'compile-error' as const }, built, check: null, source: null, diagnostics: [{ file: 'f', line: failLine, column: 2, endLine: failLine, endColumn: 6, severity: 'error' as const, message: 'unsolved goals\nx : Int\n⊢ x + x = 2 * x', kind: 'k', goal: 'x : Int\n⊢ x + x = 2 * x' }] },
      ms: 1,
    },
  ];
  it('includes the guide and the induction principles, and locates errors in the attempt text', () => {
    const p = buildProofPrompt(target, history, undefined, { guide: true, facts: 'Model.f_loop1.induct : ∀ ...' });
    expect(p).toContain(PROOF_GUIDE);
    expect(p).toContain('INDUCTION PRINCIPLES');
    expect(p).toContain('Model.f_loop1.induct');
    expect(p).toContain('your proof, line 3: `skip`');
  });
  it('is the pre-guide prompt when the guide is off', () => {
    const p = buildProofPrompt(target, history);
    expect(p).not.toContain(PROOF_GUIDE);
    expect(p).not.toContain('your proof, line');
  });
  it('maps helper lines', () => {
    expect(locateInAttempt(built.helpersStartLine + 1, built, attempt)).toBe('your helpers, line 1: `theorem h1 : True := trivial`');
    expect(locateInAttempt(1, built, attempt)).toBeNull();
  });
});

describe.skipIf(!hasLean)('Faithful.Simp through Faithful.Tactics (real Lean)', () => {
  it('normalizes pure/throw and Int.fdiv/tmod so simp and omega finish', async () => {
    const t: ProofTarget = {
      modelSource: 'import Faithful.Core\nnamespace Model\ndef original (x : Int) : Except String Int := if x < 0 then throw "neg" else pure (Int.fdiv x 2 + Int.tmod x 2)\ndef pre (x : Int) : Bool := Faithful.inRange x\nend Model\n',
      specSource: 'namespace Spec\ndef spec (x : Int) : Except String Int := if x < 0 then .error "neg" else .ok (x / 2 + x % 2)\nend Spec\n',
      theoremName: 'original_meets_spec',
      statement: '∀ (x : Int), Model.pre x = true → Model.original x = Spec.spec x',
      tacticImports: ['Faithful.Tactics'],
    };
    const proof = 'by\n  intro x _\n  simp only [Model.original, Spec.spec]\n  split\n  · rfl\n  · have h : 0 ≤ x := by omega\n    simp [h]';
    const c = await checkProof(t, { helpers: '', proof }, { budgetMs: 120_000 });
    expect(c.verdict.status).toBe('proved');
  });
});

describe.skipIf(!hasLean)('induction principles', () => {
  it('lists `.induct` of recursive model functions and skips the rest', async () => {
    const t: ProofTarget = {
      ...target,
      modelSource: 'namespace Model\ndef f_loop1 (n acc : Int) : Int := if n > 0 then f_loop1 (n - 1) (acc + n) else acc\ntermination_by n.toNat\ndef original (x : Int) : Int := f_loop1 x 0\ndef pre (x : Int) : Bool := true\nend Model\n',
      statement: '∀ (x : Int), Model.pre x = true → Model.original x = Spec.spec x',
    };
    const facts = await inductionPrinciples(t, { budgetMs: 60_000 });
    expect(facts).toContain('Model.f_loop1.induct');
    expect(facts).not.toContain('Model.original.induct');
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
  it('raises the effort per attempt as the policy says and records it', async () => {
    const bad = { helpers: '', proof: 'by\n  intro x _\n  skip', reasoning: 'x' };
    const bin = await scripted([bad, bad, bad]);
    const codex = new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 20_000 });
    const rec = await proveTheorem(codex, target, { maxAttempts: 3, budgetMs: 120_000, checkBudgetMs: 60_000, effort: ['low', 'high'], guide: true });
    expect(rec.attempts.map((a) => a.call.effort)).toEqual(['low', 'high', 'high']);
    expect(rec.attempts.map((a) => a.call.argv.at(-1))).toEqual(['model_reasoning_effort=low', 'model_reasoning_effort=high', 'model_reasoning_effort=high']);
    expect(rec.attempts[1]!.call.prompt).toContain('your proof, line');
  });
  it('reports a Codex call cut off by the loop\'s own time budget as stopped by time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slow-codex-'));
    const bin = join(dir, 'codex');
    await writeFile(bin, '#!/bin/sh\ncat >/dev/null\nsleep 30\n');
    await chmod(bin, 0o755);
    const codex = new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 60_000 });
    const rec = await proveTheorem(codex, target, { maxAttempts: 3, budgetMs: 8_000, checkBudgetMs: 60_000, guide: false });
    expect(rec.result).toBe('not-proved');
    expect(rec.stoppedBy).toBe('time');
  }, 20_000);
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

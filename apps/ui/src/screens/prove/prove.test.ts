import { describe, expect, it } from 'vitest';
import { provedSentence } from '@faithful/core/tiers';
import type { SessionEvent, StampedEvent } from '@faithful/session';
import { ATTEMPT1_GOAL } from '../../fixtures/catch';
import { assertClaimsExact } from '../../test/text';
import { CATCH, indexOf, render } from './testutil';
import {
  DIRECT_THEOREM,
  THEOREM_WORDS,
  DEFAULT_BUDGET,
  attemptVerdictText,
  budgetText,
  classifyAxioms,
  failureLineOf,
  largerBudget,
  minutesText,
  notProvedLine,
  parseBudget,
  proofElapsedMs,
} from './proveModel';

/** The catch fixture up to (not including) proof.done, then a failed proof.done. */
function failedRun(): StampedEvent[] {
  const upToAttempt1 = CATCH.slice(0, indexOf('proof.attempt') + 1);
  const done: SessionEvent = {
    kind: 'proof.done',
    theoremId: 'original_meets_spec',
    result: 'not-proved',
    accepted: null,
    ms: 252_000,
    failureLine: 'Not proved (1 attempt, 4.2 minutes)',
    stoppedBy: 'budget',
  };
  return [...upToAttempt1, { seq: 0, t: upToAttempt1.at(-1)!.t + 10, event: done }];
}

describe('"Not proved" wording', () => {
  it('uses the same formula as failureLine in packages/prover/src/prove.ts', () => {
    // Expected strings computed by that formula (the UI must not import the node-only prover package).
    const cases: Array<[number, number, string]> = [
      [1, 60_000, 'Not proved (1 attempt, 1.0 minute)'],
      [3, 252_000, 'Not proved (3 attempts, 4.2 minutes)'],
      [2, 3_000, 'Not proved (2 attempts, <0.1 minutes)'],
      [10, 600_000, 'Not proved (10 attempts, 10.0 minutes)'],
      [1, 6_000, 'Not proved (1 attempt, 0.1 minutes)'],
      [1_200, 59_999, 'Not proved (1,200 attempts, 1.0 minutes)'],
    ];
    for (const [n, ms, want] of cases) expect(notProvedLine(n, ms)).toBe(want);
    expect(notProvedLine(3, 252_000)).toBe('Not proved (3 attempts, 4.2 minutes)');
    expect(notProvedLine(1, 60_000)).toBe('Not proved (1 attempt, 1.0 minute)');
    expect(notProvedLine(2, 3_000)).toBe('Not proved (2 attempts, <0.1 minutes)');
  });

  it('prefers ProofView.failureLine and falls back to the formula', () => {
    expect(failureLineOf({ failureLine: 'Not proved (3 attempts, 4.2 minutes)', attempts: [], ms: 1 })).toBe('Not proved (3 attempts, 4.2 minutes)');
    expect(failureLineOf({ attempts: [{}, {}] as never, ms: 120_000 })).toBe('Not proved (2 attempts, 2.0 minutes)');
  });

  it('the failed screen shows the exact line, the last goal state and both offers, and never looks like a success', () => {
    const { text, html } = render(failedRun(), 'prove');
    expect(text).toContain('Not proved (1 attempt, 4.2 minutes)');
    expect(text).toContain('1 of 3'); // the budget the user chose, from proof.started
    expect(text).not.toMatch(/\bProved\b/);
    expect(text).not.toContain('Lean accepted this proof');
    expect(html).not.toContain('tier-proved');
    expect(text).toContain('absence of a proof');
    // last goal state, verbatim (⊢ line)
    expect(text).toContain(ATTEMPT1_GOAL.split('\n').at(-1)!.replace(/\s+/g, ' '));
    expect(text).toContain('A larger budget');
    expect(text).toContain('Try with a larger budget');
    expect(text).toContain(DIRECT_THEOREM);
    assertClaimsExact(text);
  });
});

describe('Prove screen, success', () => {
  it('shows Proved with provedSentence(N), the axioms and the Lean/Mathlib versions', () => {
    const { text } = render(CATCH, 'prove');
    expect(text).toContain(THEOREM_WORDS);
    expect(text).toContain('Proved');
    expect(text).toContain(provedSentence(1000));
    expect(text).toContain('propext, Classical.choice, Quot.sound');
    expect(text).toContain('Lean 4.34.0, Mathlib 5ed2965');
    expect(text).toContain('Lean did not accept this proof'); // attempt 1 stays visible
    expect(text).toContain('Lean accepted this proof'); // attempt 2
    expect((text.match(/What the model saw/g) ?? []).length).toBeGreaterThanOrEqual(2);
    assertClaimsExact(text);
  });

  it('withholds the label until the original\'s model check is recorded, and says why', () => {
    const { text } = render(CATCH.slice(0, indexOf('proof.done') + 1), 'prove');
    expect(text).not.toMatch(/\bProved\b/);
    expect(text).toContain('Lean proof accepted');
    expect(text).toContain('No check of the original\'s Lean model against its TypeScript is recorded yet');
    assertClaimsExact(text);
  });

  it('a candidate\'s model check never supplies N for the original', () => {
    const evs = [...CATCH.slice(0, indexOf('proof.done') + 1), { kind: 'model.checked', check: { subject: 'candidate', candidateId: 2, inputs: 5, disagreements: 0, seed: 1, ms: 1 } } as SessionEvent];
    const { text } = render(evs, 'prove');
    expect(text).not.toMatch(/\bProved\b/);
  });

  it('the trusting-the-compiler variant says so and explains it', () => {
    const evs = CATCH.slice(0, indexOf('proof.done') + 1).map((e) =>
      e.event.kind === 'proof.done'
        ? {
            ...e,
            event: { ...e.event, result: 'proved-trusting-compiler' as const, accepted: { ...e.event.accepted!, axioms: ['propext', 'original_meets_spec._native.native_decide.ax_1_2'] } },
          }
        : e,
    );
    // the original's model check supplies N
    const check = CATCH[indexOf('model.checked')]!;
    const { text } = render([...evs, check], 'prove');
    expect(text).toContain('Proved (trusting the compiler)');
    expect(text).toContain(provedSentence(1000));
    expect(text).toContain('native_decide');
    expect(text).toContain('also trusts the Lean compiler');
    assertClaimsExact(text);
  });
});

describe('budget', () => {
  it('defaults to the CLI/API budget (10 attempts, 12 minutes) and shows it plainly before the proof starts', () => {
    expect(DEFAULT_BUDGET).toEqual({ maxAttempts: 10, minutes: 12 });
    expect(budgetText(DEFAULT_BUDGET)).toBe('at most 10 attempts and 12 minutes');
    expect(budgetText({ maxAttempts: 1, minutes: 1 })).toBe('at most 1 attempt and 1 minute');
    const { text, html } = render(CATCH.slice(0, indexOf('proof.started')), 'prove');
    expect(text).toContain('This proof will run at most 10 attempts and 12 minutes');
    expect(text).toContain('the same as the CLI and the API');
    expect(html).toMatch(/value="10"/);
    expect(html).toMatch(/value="12"/);
  });

  it('validates attempts and minutes', () => {
    expect(parseBudget('3', '5')).toEqual({ ok: true, budget: { maxAttempts: 3, minutes: 5 } });
    expect(parseBudget('0', '5').ok).toBe(false);
    expect(parseBudget('2.5', '5').ok).toBe(false);
    expect(parseBudget('3', '').ok).toBe(false);
    expect(parseBudget('3', '-1').ok).toBe(false);
  });

  it('offers twice the recorded budget, or twice what was used when the budget is not recorded', () => {
    expect(largerBudget({ attempts: [{}, {}, {}] as never, ms: 250_000, budget: { maxAttempts: 3, minutes: 5 } })).toEqual({ maxAttempts: 6, minutes: 10 });
    expect(largerBudget({ attempts: [{}, {}] as never, ms: 250_000 })).toEqual({ maxAttempts: 4, minutes: 10 });
  });

  it('elapsed time of a running proof comes from the stream; a finished one from its record', () => {
    const i = indexOf('proof.started');
    const running = CATCH.slice(0, indexOf('proof.attempt') + 1);
    const p = { theoremId: 'original_meets_spec', result: 'running', ms: 0 } as never;
    expect(proofElapsedMs(p, running)).toBe(running.at(-1)!.t - CATCH[i]!.t);
    expect(proofElapsedMs({ theoremId: 'x', result: 'not-proved', ms: 1234 } as never, running)).toBe(1234);
    expect(minutesText(299_999)).toBe('4.9'); // a running clock never shows the limit as reached early
  });

  it('a running proof says nothing is claimed and shows the budget chosen, read from proof.started (survives a reload)', () => {
    const { text } = render(CATCH.slice(0, indexOf('proof.attempt') + 1), 'prove');
    expect(text).toContain('Nothing is claimed until Lean accepts a proof');
    expect(text).toMatch(/Attempts\s*1 of 3/);
    expect(text).toMatch(/of 5\b/);
    expect(text).toContain('waiting for the model, then Lean');
  });

  it('an older recording without a budget says it is not recorded, without guessing', () => {
    const evs = CATCH.slice(0, indexOf('proof.attempt') + 1).map((e) =>
      e.event.kind === 'proof.started' ? { ...e, event: { ...e.event, proof: { ...e.event.proof, budget: undefined } } } : e,
    );
    const { text } = render(evs, 'prove');
    expect(text).toContain('budget maximum is not recorded');
  });
});

describe('pieces', () => {
  it('attempt verdicts never say proved for a failure', () => {
    expect(attemptVerdictText({ verdict: 'failed' })).not.toMatch(/accepted/);
    expect(attemptVerdictText({ verdict: 'rejected' })).toMatch(/before Lean checked/);
  });
  it('classifies axioms', () => {
    expect(classifyAxioms(['propext', 'Quot.sound', 'Lean.ofReduceBool', 'sorryAx'])).toEqual({ standard: ['propext', 'Quot.sound'], compiler: ['Lean.ofReduceBool'], other: ['sorryAx'] });
  });
});

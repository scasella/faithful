/**
 * Step 4, Prove: one button with the full screen's default budget (DEFAULT_BUDGET: 10 attempts, 12 minutes); while it
 * runs, "Attempt n of N" and the elapsed minutes; when Lean accepted none, "Not proved (…)" and the full screen's two
 * offers: a larger budget, or continue without the proof. A proved result moves on to the Faster step, which shows the
 * label with its sentence above its one button.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ProofView } from '@faithful/session';
import { formatCount } from '@faithful/core/tiers';
import { useApp } from '../app/AppContext';
import { Code } from '../components/Code';
import {
  DEFAULT_BUDGET,
  THEOREM_WORDS,
  attemptVerdictText,
  budgetText,
  failureLineOf,
  largerBudget,
  minutesText,
  originalProof,
  proofElapsedMs,
} from '../screens/prove/proveModel';
import { Actions, CarveOuts, Details, SButton, StepHead } from './parts';

export function ProveStep({ onContinue }: { onContinue(): void }) {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const p = originalProof(s);
  if (!p) {
    return (
      <section class="s-step">
        <StepHead lead={THEOREM_WORDS}>
          Prove that <code>{s.fn}</code> meets the spec
        </StepHead>
        <CarveOuts s={s} lead="The proof will not cover these carved-out inputs" />
        <Actions note={`The model writes proof attempts and Lean checks each one: ${budgetText(DEFAULT_BUDGET)}.`}>
          <SButton primary disabled={!s.agreement} why="Agree on a spec first" run={() => adapter.proveOriginal(DEFAULT_BUDGET)}>
            Prove it
          </SButton>
        </Actions>
      </section>
    );
  }
  if (p.result === 'running') return <Running p={p} />;
  const bigger = largerBudget(p);
  return (
    <section class="s-step">
      <StepHead lead={`${failureLineOf(p)}. Lean accepted none of the attempts. That does not show the function is wrong; it means there is no proof.`}>Not proved</StepHead>
      <Actions note="Without it, a candidate can still be proved equal to your original directly, later in the loop.">
        <SButton primary local run={onContinue}>
          Continue without the proof
        </SButton>
        <SButton run={() => adapter.proveOriginal(bigger)}>
          Try again with {formatCount(bigger.maxAttempts)} attempts and {bigger.minutes} minutes
        </SButton>
      </Actions>
      <Attempts p={p} />
    </section>
  );
}

function Running({ p }: { p: ProofView }) {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const events = store.events.value;
  const base = proofElapsedMs(p, events);
  const live = !adapter.readOnly;
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = Date.now();
    setSince(t);
    setNow(t);
  }, [events.length]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const elapsed = live ? base + Math.max(0, now - since) : base;
  const n = p.attempts.length + 1;
  const max = p.budget?.maxAttempts ?? null;
  return (
    <section class="s-step">
      <StepHead lead="Nothing is claimed until Lean accepts a proof.">
        Proving <code>{s.fn}</code>
      </StepHead>
      <p class="s-big-line" aria-live="off">
        Attempt {formatCount(Math.min(n, max ?? n))}
        {max !== null ? ` of ${formatCount(max)}` : ''}
        <span class="s-big-sub">
          {' '}
          · {minutesText(elapsed)} minutes{p.budget ? ` of ${p.budget.minutes}` : ''}
        </span>
      </p>
      <CarveOuts s={s} lead="The proof will not cover these carved-out inputs" />
      <Actions />
      <Attempts p={p} />
    </section>
  );
}

function Attempts({ p }: { p: ProofView }) {
  if (!p.attempts.length) return null;
  return (
    <Details summary="Attempts">
      <p class="s-note">{THEOREM_WORDS}</p>
      <ol class="s-plain">
        {p.attempts.map((a) => (
          <li key={a.n}>
            Attempt {a.n}: {attemptVerdictText(a)}.{a.failureReason ? ` ${a.failureReason}` : ''}
          </li>
        ))}
      </ol>
      <Code text={p.statement} lang="lean" label="Theorem in Lean" />
    </Details>
  );
}

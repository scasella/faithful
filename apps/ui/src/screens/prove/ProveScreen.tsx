/**
 * Prove original: the theorem (Lean and plain words), the budget (attempts and minutes, used of max, ticking while it
 * runs), every attempt with its proof text, verdict, diagnostics and goal states, and "What the model saw".
 * Success shows the tier with provedSentence(N), the axioms Lean reported and the Lean/Mathlib versions. Failure shows
 * exactly "Not proved (N attempts, M minutes)" with the last goal state and two offers. A failure is never softened.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ProofAttemptView, ProofView } from '@faithful/session';
import { formatCount } from '@faithful/core/tiers';
import { useApp } from '../../app/AppContext';
import { ActionButton } from '../../components/ActionButton';
import { Code } from '../../components/Code';
import { KeyHint } from '../../components/KeyHint';
import { ModelSaw } from '../../components/ModelSaw';
import { Num } from '../../components/Provenance';
import { TierBadge } from '../../components/TierBadge';
import { callById, originalModelCheck } from '../../lib/facts';
import { msText } from '../../lib/format';
import { leanVersions } from '../../lib/provenance';
import { ThresholdChoice } from '../optimize/ThresholdChoice';
import { thresholdWords } from '../optimize/threshold';
import {
  DEFAULT_BUDGET,
  DIRECT_THEOREM,
  THEOREM_WORDS,
  TRUSTING_COMPILER_EXPLAINED,
  attemptVerdictText,
  budgetText,
  classifyAxioms,
  failureLineOf,
  isProvedResult,
  largerBudget,
  minutesText,
  originalProof,
  parseBudget,
  proofElapsedMs,
} from './proveModel';
import './prove.css';

export function ProveScreen() {
  const { store } = useApp();
  const s = store.state.value;
  const p = originalProof(s);
  return (
    <div class="stack-l pv-screen">
      <TheoremBlock proof={p} />
      {p ? <ProofBody proof={p} /> : <StartProof />}
      {p && p.result !== 'running' && <NextStep proof={p} />}
    </div>
  );
}

function TheoremBlock({ proof }: { proof: ProofView | null }) {
  const { store } = useApp();
  const s = store.state.value;
  const pre = s.agreement ? [...s.agreement.preconditions, ...s.agreement.carveOuts] : [];
  return (
    <section class="stack" aria-labelledby="thm-title">
      <h3 id="thm-title">The theorem</h3>
      <p class="pv-thm-words">{THEOREM_WORDS}</p>
      {proof && proof.statementWords && proof.statementWords !== THEOREM_WORDS && <p class="muted">Stated for this function: {proof.statementWords}</p>}
      {proof ? (
        <Code text={proof.statement} lang="lean" label="Theorem in Lean" />
      ) : (
        <p class="muted">The Lean statement appears when the proof starts; it is generated from the agreement, not written by the model.</p>
      )}
      {pre.length > 0 && (
        <details class="saw">
          <summary>
            <span>Preconditions and carve-outs it assumes</span>
            <span class="muted">
              · <Num what="Preconditions and carve-outs in the agreement">{formatCount(pre.length)}</Num>
            </span>
          </summary>
          <ul class="pv-pre-list">
            {pre.map((c) => (
              <li key={c.id} class={c.kind === 'carve-out' ? 'pv-carve-item' : undefined}>
                {c.kind === 'carve-out' && <span class="label">Carve-out </span>}
                {c.words}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function StartProof() {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const [a, setA] = useState(String(DEFAULT_BUDGET.maxAttempts));
  const [m, setM] = useState(String(DEFAULT_BUDGET.minutes));
  const parsed = parseBudget(a, m);
  if (!s.agreement) return <p class="muted">Agree on a spec first; the theorem is pinned to the agreement.</p>;
  return (
    <section class="stack" aria-labelledby="budget-title">
      <h3 id="budget-title">Budget</h3>
      <p class="muted">The model writes proof attempts; Lean checks each one. It stops at the first accepted proof or when either limit is reached.</p>
      <p class="pv-budget-plain">
        This proof will run {parsed.ok ? budgetText(parsed.budget) : 'with the limits below once they are valid'}. The default is {budgetText(DEFAULT_BUDGET)}, the same as the CLI and the API.
      </p>
      <div class="fx-fields">
        <label class="fx-field">
          <span>Attempts at most</span>
          <input type="number" min="1" max="50" step="1" value={a} onInput={(e) => setA((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="fx-field">
          <span>Minutes at most</span>
          <input type="number" min="1" max="240" step="1" value={m} onInput={(e) => setM((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      {!parsed.ok && (
        <p class="err-inline" role="status">
          {parsed.error}
        </p>
      )}
      <div>
        <ActionButton
          primary
          keyName="p"
          disabled={!parsed.ok}
          run={async () => {
            if (!parsed.ok) return;
            await adapter.proveOriginal(parsed.budget);
          }}
        >
          Prove the original
        </ActionButton>
      </div>
    </section>
  );
}

/** Elapsed time of a running proof: stream time to the latest event, plus local time since it arrived (live only). */
function useElapsed(p: ProofView): number {
  const { store, adapter } = useApp();
  const events = store.events.value;
  const base = proofElapsedMs(p, events);
  const live = p.result === 'running' && !adapter.readOnly;
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
  return live ? base + Math.max(0, now - since) : base;
}

function BudgetLine({ proof }: { proof: ProofView }) {
  const elapsed = useElapsed(proof);
  const budget = proof.budget ?? null;
  const used = proof.attempts.length;
  const running = proof.result === 'running';
  if (!budget) {
    // Without a recorded maximum, two big numbers in tiles read like a scoreboard. Say what was used, in a sentence.
    return (
      <p class="pv-budget-sentence" aria-live="off">
        {running ? 'So far: ' : 'Used: '}
        <Num what="Proof attempts made so far">
          {formatCount(used)} attempt{used === 1 ? '' : 's'}
        </Num>{' '}
        and{' '}
        <Num what={running ? 'Time since the proof started (stream time, plus local time since the latest event)' : 'Total time of the proof run, model calls and Lean checks'}>
          {minutesText(elapsed)} minutes
        </Num>
        . <span class="muted fx-small">The budget maximum is not recorded for this proof run (it predates budgets in the event stream).</span>
      </p>
    );
  }
  return (
    <div class="pv-budget" aria-live="off">
      <div class="pv-budget-cell">
        <p class="label">Attempts</p>
        <p class="pv-budget-v">
          <Num what="Proof attempts made so far, of the maximum you chose (recorded when the proof started)">{`${formatCount(used)} of ${formatCount(budget.maxAttempts)}`}</Num>
        </p>
      </div>
      <div class="pv-budget-cell">
        <p class="label">Minutes{running ? ', running' : ''}</p>
        <p class="pv-budget-v">
          <Num what={running ? 'Time since the proof started (stream time, plus local time since the latest event)' : 'Total time of the proof run, model calls and Lean checks'}>
            {`${minutesText(elapsed)} of ${budget.minutes}`}
          </Num>
        </p>
      </div>
    </div>
  );
}

function Verdict({ proof }: { proof: ProofView }) {
  const { store } = useApp();
  const s = store.state.value;
  const mc = originalModelCheck(s);
  const n = mc?.inputs ?? null;
  if (proof.result === 'running') return <p class="muted pv-verdict">Running. Nothing is claimed until Lean accepts a proof.</p>;
  if (proof.result === 'not-proved') {
    const last = lastGoal(proof);
    return (
      <div class="pv-verdict pv-not-proved stack">
        <p class="pv-fail-line">
          <Num what="Attempts made and total time of the proof run (model calls and Lean checks)">{failureLineOf(proof)}</Num>
        </p>
        {proof.stoppedBy === 'spec-changed' && <p class="muted">This run was pinned to an earlier agreement that has since been invalidated.</p>}
        <p>Lean accepted none of the attempts. A failed proof is the absence of a proof: it does not show that the function is wrong, and it does not count as evidence.</p>
        {last && (
          <div>
            <p class="label">Last goal state (attempt {last.n})</p>
            <Code text={last.goal} lang="lean" label="Last unsolved goal state" />
          </div>
        )}
      </div>
    );
  }
  if (!s.agreement || proof.pinnedTo !== s.agreement.hash) {
    return (
      <p class="pv-verdict muted">
        Lean accepted a proof against an earlier agreement, which has since been invalidated. It is not a claim about the current spec.
      </p>
    );
  }
  const ax = classifyAxioms(proof.accepted?.axioms ?? []);
  const lv = leanVersions(s.toolchain);
  return (
    <div class="pv-verdict pv-proved stack">
      <TierBadge tier={proof.result} n={n} mismatches={mc?.disagreements} />
      {n === null && (
        <p class="muted fx-small">
          No check of the original's Lean model against its TypeScript is recorded yet. The server records one at the latest when it writes the delivery, and the label is shown with its number from then on.
        </p>
      )}
      <p>
        {proof.accepted && proof.accepted.axioms.length ? (
          <>
            Lean reports the axioms <code>{proof.accepted.axioms.join(', ')}</code>
            {ax.other.length === 0 && ax.compiler.length === 0 ? ': standard axioms only, nothing else.' : '.'}
          </>
        ) : (
          'Lean reports no axioms for this proof.'
        )}
        {lv && <span class="muted"> Checked with {lv}.</span>}
      </p>
      {proof.result === 'proved-trusting-compiler' && <p class="pv-trust-note">{TRUSTING_COMPILER_EXPLAINED}</p>}
    </div>
  );
}

function lastGoal(p: ProofView): { n: number; goal: string } | null {
  for (let i = p.attempts.length - 1; i >= 0; i--) {
    const a = p.attempts[i]!;
    const d = [...a.diagnostics].reverse().find((x) => x.goal);
    if (d?.goal) return { n: a.n, goal: d.goal };
  }
  return null;
}

function ProofBody({ proof }: { proof: ProofView }) {
  return (
    <section class="stack" aria-labelledby="proof-title">
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <h3 id="proof-title">Proof</h3>
      </div>
      <BudgetLine proof={proof} />
      <Verdict proof={proof} />
      <ol class="pv-attempts" aria-label="Proof attempts">
        {proof.attempts.map((a) => (
          <Attempt key={a.n} a={a} />
        ))}
        {proof.result === 'running' && (
          <li class="pv-attempt pv-pending">
            <p class="muted">Attempt {proof.attempts.length + 1}: waiting for the model, then Lean.</p>
          </li>
        )}
      </ol>
    </section>
  );
}

function Attempt({ a }: { a: ProofAttemptView }) {
  const { store } = useApp();
  const s = store.state.value;
  const ok = a.verdict === 'proved' || a.verdict === 'proved-trusting-compiler';
  return (
    <li class={`pv-attempt panel stack ${ok ? 'pv-ok' : 'pv-bad'}`}>
      <p class="pv-attempt-head">
        <b>Attempt {a.n}</b> <span class={ok ? 'pv-ok-word' : 'pv-bad-word'}>{attemptVerdictText(a)}</span>
        <span class="muted">
          {' '}
          · <Num what={`Proof attempt ${a.n}: model call plus Lean check`}>{msText(a.ms)}</Num>
        </span>
      </p>
      {a.failureReason && <p>{a.failureReason}</p>}
      {a.diagnostics.length > 0 && (
        <ul class="pv-diags" aria-label={`Lean messages for attempt ${a.n}`}>
          {a.diagnostics.map((d, i) => (
            <li key={i} class="stack">
              <p>
                <span class="mono muted">
                  line {d.line}, column {d.column}
                </span>{' '}
                {d.message}
              </p>
              {d.goal && <Code text={d.goal} lang="lean" label={`Goal state at line ${d.line}`} caption="Goal state reported by Lean" />}
            </li>
          ))}
        </ul>
      )}
      <details class="saw">
        <summary>Proof text</summary>
        <Code text={(a.helpers ? a.helpers + '\n\n' : '') + a.proof} lang="lean" label={`Proof attempt ${a.n}`} />
      </details>
      <ModelSaw call={callById(s, a.callId)} what={`proof attempt ${a.n}`} />
    </li>
  );
}

function NextStep({ proof }: { proof: ProofView }) {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const proved = isProvedResult(proof.result);
  const started = s.optimize.startedAt !== null;
  const bigger = largerBudget(proof);
  return (
    <div class="stack-l">
      {proof.result === 'not-proved' && !started && (
        <section class="stack pv-offers" aria-labelledby="offers-title">
          <h3 id="offers-title">Two ways on</h3>
          <div class="panel stack">
            <p>
              <b>A larger budget.</b> Run the proof again with{' '}
              <Num what="Twice the budget of the failed run (or twice what was used, when its budget is not recorded)">
                {formatCount(bigger.maxAttempts)} attempts and {bigger.minutes} minutes
              </Num>
              . Earlier attempts and their goal states are kept above.
            </p>
            <div>
              <ActionButton
                keyName="b"
                run={async () => {
                  await adapter.proveOriginal(bigger);
                }}
              >
                Try with a larger budget
              </ActionButton>
            </div>
          </div>
          <div class="panel stack">
            <p>
              <b>The direct theorem, later in the loop.</b> Optimize without a proof of the original. A candidate can then be proved equal to the original
              itself, which does not need the spec proof:
            </p>
            <Code text={DIRECT_THEOREM} lang="lean" label="Direct theorem" />
            <p class="muted">Start it below by choosing when optimizing should stop.</p>
          </div>
        </section>
      )}
      {started && s.optimize.threshold ? (
        <p class="muted">
          Optimizing started: <Num what="Threshold chosen when optimization started">{thresholdWords(s.optimize.threshold)}</Num> Press <KeyHint keys={['→', ']']} /> to follow it.
        </p>
      ) : (
        !started && <ThresholdChoice originalProved={proved} />
      )}
    </div>
  );
}

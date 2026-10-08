/**
 * Step 5, Faster. Before it starts: the original's label (with its Proved sentence, or "not proved") and one button with
 * the full Optimize screen's default threshold. While it runs: the current best in one sentence, a Stop button, and one
 * row per candidate (name, label, speedup with its 95% CI or the one-line reason it stopped). A rejected candidate with
 * a counterexample expands to the input and both outputs.
 */
import { testedCaveatWords, testedIncludedWords, type CandidateRecord, type SessionState } from '@faithful/session';
import { TIER_LABEL } from '@faithful/core/tiers';
import { useApp } from '../app/AppContext';
import { GATE_LABEL } from '../components/gates';
import { InlineText } from '../components/InlineText';
import { TierBadge } from '../components/TierBadge';
import { OutcomeView } from '../components/ValueView';
import { catchView } from '../lib/catch';
import { candidateModelCheck, incumbent, nForCandidate, nForOriginal, originalModelCheck, paramNames, smtK } from '../lib/facts';
import { canSayFaster, ratioText, speedupCiText } from '../lib/format';
import { TestedTierLine } from '../screens/optimize/OptimizeScreen';
import { acceptBlocker, acceptConsequence, verdictText } from '../screens/optimize/speed';
import { thresholdWords } from '../screens/optimize/threshold';
import { whyNotStronger } from '../screens/optimize/why';
import { isProvedResult, originalProof } from '../screens/prove/proveModel';
import { Actions, CarveOuts, Details, SButton, StepHead } from './parts';
import { defaultThreshold } from './TranslateStep';
import { optimizeFailed } from './flow';
import { testedLoadFailed, useTestedBlock } from '../screens/translate/testedCheck';

export function FasterStep({ onPickAnother }: { onPickAnother?(): void } = {}) {
  const { store } = useApp();
  const s = store.state.value;
  return s.optimize.startedAt === null ? <Start s={s} onPickAnother={onPickAnother} /> : <Running s={s} onPickAnother={onPickAnother} />;
}

/** The original's own label, as the full screens show it: the proof's tier with provedSentence(N), or why there is none. */
export function OriginalLabel({ s }: { s: SessionState }) {
  const p = originalProof(s);
  const mc = originalModelCheck(s);
  if (s.tested) return <p class="s-body">Your original is the reference every candidate is compared with; no claim is made about it.</p>;
  if (p && isProvedResult(p.result) && s.agreement && p.pinnedTo === s.agreement.hash) {
    return (
      <div class="s-label-box">
        <p class="s-kicker">The original against the agreed spec</p>
        <TierBadge tier={p.result} n={nForOriginal(s)} mismatches={mc?.disagreements} />
      </div>
    );
  }
  return <p class="s-body">The original is not proved against the agreed spec. A candidate can still reach the proof tier through a direct proof that it equals the original.</p>;
}

function Start({ s, onPickAnother }: { s: SessionState; onPickAnother?(): void }) {
  const { adapter } = useApp();
  const th = defaultThreshold();
  const failed = !!s.job.lastError && !s.job.running;
  // a failure the server's preflight would also report (the file cannot load in the sandbox) is deterministic
  const preflight = useTestedBlock(!!s.tested && failed && s.job.lastError?.job === 'tested', s);
  const never = s.tested && failed ? (testedLoadFailed(s) ?? preflight) : null;
  if (s.tested && never) {
    // Deterministic: trying again would fail the same way. The plain reason replaces the raw job error.
    return (
      <section class="s-step">
        <StepHead lead={<InlineText text={never} />}>
          <code>{s.fn}</code> can't be tested here
        </StepHead>
        <Actions errorJobs={[]}>
          {onPickAnother && (
            <SButton primary local run={onPickAnother}>
              Pick another function
            </SButton>
          )}
        </Actions>
      </section>
    );
  }
  if (s.tested) {
    // Tested-only path: the server benchmarks the original before optimizing starts; the job line says so.
    return (
      <section class="s-step">
        <StepHead lead="The original is measured first; candidates follow.">
          Finding a faster <code>{s.fn}</code>
        </StepHead>
        <Actions>
          {/* the run failed before optimizing started: say so (the job line) and offer the ways on. A retry keeps the
              recorded choice (the server logs tested.started once). */}
          {failed && (
            <SButton primary run={() => adapter.startTestedOnly(th, { specials: s.tested!.specials })}>
              Try again
            </SButton>
          )}
          {failed && onPickAnother && (
            <SButton local run={onPickAnother}>
              Pick another function
            </SButton>
          )}
        </Actions>
      </section>
    );
  }
  return (
    <section class="s-step">
      <StepHead lead="The model proposes candidates. Each must compile, stay pure, match your original on generated inputs and under bounded Z3, and be measurably faster before a Lean proof is tried.">
        Find a faster version
      </StepHead>
      <CarveOuts s={s} />
      <OriginalLabel s={s} />
      <Actions note={thresholdWords(th)}>
        <SButton primary run={() => adapter.startOptimize(th)}>
          Find a faster version
        </SButton>
      </Actions>
    </section>
  );
}

/**
 * Tested-only: which declarations of the file the original ran with (recorded in `tested.started`; absent in older
 * recordings, which loaded the whole file and say nothing here).
 */
export function TestedRanWith({ s }: { s: SessionState }) {
  const words = testedIncludedWords(s.tested);
  if (!words) return null;
  return (
    <Details summary="What ran as the original">
      <p class="s-body">{words}</p>
      {testedCaveatWords(s.tested).map((c) => (
        <p class="s-body">{c}</p>
      ))}
    </Details>
  );
}

/** "Current best: candidate 2, 3.1× faster than the original (95% CI …)." or "The original stands." */
export function bestSentence(s: SessionState): string {
  const inc = incumbent(s);
  if (!inc) return s.optimize.stoppedBy === null ? 'No faster candidate yet: the original stands.' : 'The original stands.';
  if (!inc.speedup) return `Current best: candidate ${inc.id}. No speedup is recorded.`;
  if (canSayFaster(inc.speedup)) return `Current best: candidate ${inc.id}, ${ratioText(inc.speedup)} faster than the original (${speedupCiText(inc.speedup)}).`;
  return `Current best: candidate ${inc.id}. Speedup vs the original ${ratioText(inc.speedup)} (${speedupCiText(inc.speedup)}). ${verdictText(inc).text}`;
}

function Running({ s, onPickAnother }: { s: SessionState; onPickAnother?(): void }) {
  const { adapter } = useApp();
  const o = s.optimize;
  // The job failed after optimizing started: there is nothing to stop and no stop event will come. Say so (the job
  // line under the buttons) and offer the way on, as the failure before the start does.
  const failed = optimizeFailed(s);
  return (
    <section class="s-step">
      <StepHead lead={failed ? `The run ended with an error, so it has no result.${o.candidates.length ? ' The candidates it checked before that are listed below.' : ''}` : bestSentence(s)}>
        {failed ? (
          <>
            The search for a faster <code>{s.fn}</code> failed
          </>
        ) : (
          <>
            Looking for a faster <code>{s.fn}</code>
          </>
        )}
      </StepHead>
      <CarveOuts s={s} />
      <TestedRanWith s={s} />
      <Candidates s={s} />
      <Actions note={!failed && o.threshold ? thresholdWords(o.threshold) : undefined}>
        {failed ? (
          onPickAnother && (
            <SButton primary local run={onPickAnother}>
              Pick another function
            </SButton>
          )
        ) : (
          <SButton whileBusy run={() => adapter.stopOptimize()}>
            Stop
          </SButton>
        )}
      </Actions>
      {!failed && <AcceptOffer s={s} />}
    </section>
  );
}

const OUTCOME_LINE: Record<CandidateRecord['outcome'], string> = {
  running: 'Checking',
  incumbent: 'Current best',
  'faster-not-proved': 'Faster, not proved',
  'accepted-at-verified': 'Accepted by you at its tier',
  rejected: 'Rejected',
  'not-faster': 'Not faster',
};

/** The one-line reason a candidate stopped where it did (verbatim from the session), or what it is doing now. */
export function candidateLine(s: SessionState, c: CandidateRecord): string {
  if (c.outcome === 'running') {
    const st = c.stages.find((x) => x.status === 'running');
    return st ? `Checking: ${GATE_LABEL[st.stage]}` : 'Checking';
  }
  if (c.outcome === 'rejected') return catchView(c, paramNames(s), nForCandidate(s, c))?.caughtBy ?? 'Rejected; no reason was recorded.';
  if (c.outcome === 'not-faster') return c.rejection?.reason ? `Not faster: ${c.rejection.reason}` : 'Not faster than the current best.';
  if (c.outcome === 'faster-not-proved') {
    const why = whyNotStronger(c);
    return why?.lines[0] ? `Faster, not proved. ${why.lines[0]}` : 'Faster, not proved.';
  }
  return OUTCOME_LINE[c.outcome];
}

export function CandidateLabel({ s, c }: { s: SessionState; c: CandidateRecord }) {
  if (!c.tier) return null;
  if (s.tested && c.tier === 'tested') return <TestedTierLine c={c} />;
  const mc = candidateModelCheck(s, c.id);
  return <TierBadge tier={c.tier} n={nForCandidate(s, c)} mismatches={mc?.disagreements} k={smtK(c)} />;
}

function Candidates({ s }: { s: SessionState }) {
  const list = s.optimize.candidates;
  if (!list.length && optimizeFailed(s)) return null;
  if (!list.length) return <p class="s-note">No candidate yet. The first appears here as soon as the model proposes it.</p>;
  const names = paramNames(s);
  return (
    <ol class="s-cands" aria-label="Candidates">
      {list.map((c) => {
        const cv = c.outcome === 'rejected' ? catchView(c, names, nForCandidate(s, c)) : null;
        const cx = cv?.counterexample ?? null;
        return (
          <li key={c.id} class={`s-cand s-cand-${c.outcome}`}>
            <div class="s-cand-head">
              <span class="s-cand-name">Candidate {c.id}</span>
              <CandidateLabel s={s} c={c} />
              {c.speedup && (
                <span class="s-cand-speed">
                  {ratioText(c.speedup)} <span class="s-ci">({speedupCiText(c.speedup)})</span>
                </span>
              )}
            </div>
            <p class="s-cand-line">
              <InlineText text={candidateLine(s, c)} />
            </p>
            {cx && cv && (
              <details class="s-cx-details">
                <summary>{cv.differs ? 'Show the input where it differs' : 'Show the input'}</summary>
                <dl class="s-cx s-cx-catch">
                  <div>
                    <dt>Input</dt>
                    <dd class="val">{cx.inputLine}</dd>
                  </div>
                  <div>
                    <dt>Original</dt>
                    <dd>
                      <OutcomeView o={cx.original} />
                    </dd>
                  </div>
                  <div>
                    <dt>Candidate {c.id}</dt>
                    <dd class="s-cx-bad">
                      <OutcomeView o={cx.candidate} />
                    </dd>
                  </div>
                </dl>
                <p class="s-note">
                  <InlineText text={cv.reason} />
                </p>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Accepting a faster, not proved candidate at Verified to k: offered only where acceptBlocker allows, as on the full screen. */
export function AcceptOffer({ s }: { s: SessionState }) {
  const { adapter } = useApp();
  const open = s.optimize.candidates.filter((c) => c.outcome === 'faster-not-proved' && acceptBlocker(c) === null);
  if (!open.length) return null;
  const inc = incumbent(s);
  return (
    <Details summary={`Faster, not proved: accept ${open.length === 1 ? `candidate ${open[0]!.id}` : 'a candidate'} at ${TIER_LABEL['verified-to-k']}?`}>
      {open.map((c) => (
        <div key={c.id} class="s-accept">
          {acceptConsequence(c, inc).map((t) => (
            <p key={t}>{t}</p>
          ))}
          <div class="s-buttons">
            <SButton run={() => adapter.acceptFasterNotProved(c.id)}>Accept candidate {c.id} without a proof</SButton>
          </div>
        </div>
      ))}
    </Details>
  );
}

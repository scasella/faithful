/**
 * The hero: the moment a check catches a faster candidate that is wrong (or, for proof failures, not proved).
 *
 * One glance: the speedup that was given up (struck through), what caught it (tier + stage), the concrete input with
 * both outputs side by side (or the theorem and the failing goal), and a five-second reason. "Why this is believable"
 * expands to the exact tier label and the sentence for the stage. This card is the only emphasized element in the UI:
 * color, size, and one 200ms ease-in (disabled under prefers-reduced-motion).
 *
 * Exactness: the heading says "differs" only with a concrete counterexample; a failed proof is "not proved".
 */
import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import type { CallRecord, CandidateRecord } from '@faithful/session';
import { catchView } from '../lib/catch';
import { ciText, ratioText } from '../lib/format';
import { Code } from './Code';
import { InlineText } from './InlineText';
import { ModelSaw } from './ModelSaw';
import { Num, ProvText, N_WHAT } from './Provenance';
import { smtK, stageOf } from '../lib/facts';
import { stageSummaryText } from '../lib/tierText';
import { formatCount } from '@faithful/core/tiers';
import { OutcomeView, ValueView } from './ValueView';

export interface CatchCardProps {
  candidate: CandidateRecord;
  /** Parameter names of the function, for "n = 2". */
  params: string[] | null;
  /** N for provedSentence(N): this candidate's own model check; null when not recorded. */
  modelChecked: number | null;
  /** The model call that produced the candidate (What the model saw). */
  call: CallRecord | null;
  /** Start with "Why this is believable" open (gallery, tests). */
  openWhy?: boolean;
  /** Shown inside the card under the counterexample, e.g. the candidate's funnel strip. */
  children?: ComponentChildren;
}

export function CatchCard({ candidate, params, modelChecked, call, openWhy = false, children }: CatchCardProps) {
  const v = catchView(candidate, params, modelChecked);
  const [why, setWhy] = useState(openWhy);
  const headId = useId();
  const whyId = useId();
  if (!v) return null;
  const cx = v.counterexample;
  const stage = stageOf(candidate, v.stage);
  const k = smtK(candidate);
  const tokens = [
    ...(k !== null ? [{ token: `k=${k}`, what: 'Bound Z3 searched to (SMT stage)' }] : []),
    ...(modelChecked !== null ? [{ token: `${formatCount(modelChecked)} inputs`, what: N_WHAT }] : []),
  ];
  return (
    <article class="catch" aria-labelledby={headId} data-kind={v.kind}>
      <div class="catch-head">
        <div>
          <p class="catch-kicker">
            Candidate {v.candidateId} · round {v.round} · rejected
          </p>
          <h3 id={headId}>{v.heading}</h3>
          <p class="catch-by">
            <Num what={`${v.stage} stage${stage ? `: ${stageSummaryText(stage.summary)}` : ''}`}>{v.caughtBy}</Num>.
          </p>
        </div>
        <div class="catch-speed">
          {v.speedup ? (
            <>
              <p class="label">Speedup given up</p>
              <p>
                <del class="was">
                  <Num what="Measured on this candidate before it was rejected; not kept">{ratioText(v.speedup)}</Num>
                </del>
              </p>
              <p>
                <del class="ci">
                  <Num what="Bootstrap interval of the discarded speedup">{ciText(v.speedup.lo, v.speedup.hi)}</Num>
                </del>
              </p>
            </>
          ) : (
            <p class="note">{v.speedupNote}</p>
          )}
        </div>
      </div>

      <p class="catch-reason">
        <InlineText text={v.reason} />
        {v.reasonDerived && cx && <span class="derived">Written from the counterexample: no reason was recorded for this rejection.</span>}
      </p>

      {cx && (
        <div class="catch-cx" role="group" aria-label="Counterexample">
          <div>
            <p class="label">Input</p>
            <p class="v">
              {cx.inputs.map((x, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  {x.name && <span class="val">{x.name} = </span>}
                  <ValueView v={x.value} />
                </span>
              ))}
            </p>
          </div>
          <div class="orig">
            <p class="label">Original returns</p>
            <p class="v">
              <OutcomeView o={cx.original} />
            </p>
          </div>
          <div class="cand">
            <p class="label">Candidate returns</p>
            <p class="v">
              <OutcomeView o={cx.candidate} />
            </p>
          </div>
        </div>
      )}

      {(v.theorem || v.goal) && (
        <div class="catch-goal stack">
          {v.theorem && (
            <div>
              <p class="label">Theorem</p>
              <Code text={v.theorem} lang="lean" label="Theorem that was not proved" />
            </div>
          )}
          {v.goal && (
            <div>
              <p class="label">Failing goal</p>
              <Code text={v.goal} lang="lean" label="Unsolved goal state" />
            </div>
          )}
        </div>
      )}

      {children && <div class="catch-extra">{children}</div>}

      <div class="catch-why">
        <button type="button" class="catch-why-toggle" aria-expanded={why} aria-controls={whyId} onClick={() => setWhy(!why)}>
          <span class="q" aria-hidden="true">
            ?
          </span>
          Why this is believable
        </button>
        {why && (
          <div class="catch-why-body" id={whyId}>
            {v.believe.tierLabel && (
              <p>
                <span class="label">Tier</span> <b>{v.believe.tierLabel}</b> · <span class="label">Stage</span> <b>{v.stage}</b>
              </p>
            )}
            {v.believe.sentences.map((s) => (
              <p key={s}>
                <ProvText text={s} tokens={tokens} />
              </p>
            ))}
          </div>
        )}
        <details class="saw">
          <summary>Candidate source</summary>
          <Code text={candidate.source} lang="ts" label={`Source of candidate ${candidate.id}`} />
        </details>
        <ModelSaw call={call} what={`candidate ${candidate.id}`} />
      </div>
    </article>
  );
}

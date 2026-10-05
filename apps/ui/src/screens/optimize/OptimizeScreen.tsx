/**
 * Optimize: the chosen threshold, the incumbent, the candidates (each with its funnel strip and timings, benchmark
 * readout with the 95% CI, and "What the model saw"), rejected candidates as CatchCards, and the accept-at-Verified-to-k
 * action for "faster, not proved" candidates. Once stopped: the final readout and the delivery action.
 *
 * Live stream without jumping: candidates keep their order (by id) and are only appended; every panel above the list
 * keeps a constant structure; nothing auto-scrolls (browser scroll anchoring keeps the reader's place).
 */
import { useState } from 'preact/hooks';
import type { BenchSummary, CandidateRecord } from '@faithful/session';
import { TIER_LABEL, formatCount } from '@faithful/core/tiers';
import { useApp } from '../../app/AppContext';
import { ActionButton } from '../../components/ActionButton';
import { CatchCard } from '../../components/CatchCard';
import { Code } from '../../components/Code';
import { Evidence } from '../../components/Evidence';
import { Funnel } from '../../components/Funnel';
import { InlineText } from '../../components/InlineText';
import { KeyHint } from '../../components/KeyHint';
import { ModelSaw } from '../../components/ModelSaw';
import { Num, ProvText } from '../../components/Provenance';
import { TierBadge } from '../../components/TierBadge';
import { callById, candidateModelCheck, candidateProofCalls, differentialDetail, incumbent, nForCandidate, paramNames, smtK, stageOf } from '../../lib/facts';
import { ciText, nsText, ratioText, speedupCiText } from '../../lib/format';
import { ThresholdChoice } from './ThresholdChoice';
import { thresholdWords } from './threshold';
import { STAGE_LABEL } from '../../lib/catch';
import { acceptBlocker, acceptConsequence, finalReadout, verdictText, verifiedLabel } from './speed';
import './optimize.css';

/** `k=N` tokens of a candidate's SMT stage, so the bound opens its provenance wherever it appears in prose. */
function kTokens(c: CandidateRecord): Array<{ token: string; what: string }> {
  const k = smtK(c);
  return k === null ? [] : [{ token: `k=${k}`, what: `Bound Z3 searched to for candidate ${c.id} (SMT stage)` }];
}

const OUTCOME_WORDS: Record<CandidateRecord['outcome'], string> = {
  running: 'Checking',
  incumbent: 'Current best',
  'faster-not-proved': 'Faster, not proved',
  'accepted-at-verified': 'Accepted by you at its tier',
  rejected: 'Rejected',
  'not-faster': 'Not faster',
};

export function OptimizeScreen() {
  const { store } = useApp();
  const s = store.state.value;
  const o = s.optimize;
  if (o.startedAt === null) {
    const p = s.proofs.at(-1);
    return (
      <div class="stack-l op-screen">
        <ThresholdChoice originalProved={p?.result === 'proved' || p?.result === 'proved-trusting-compiler'} />
      </div>
    );
  }
  return (
    <div class="stack-l op-screen">
      {s.tested && <TestedOnlyPanel />}
      <Header />
      <Final />
      {o.stoppedBy === null && <IncumbentPanel />}
      <section class="stack" aria-labelledby="cands-title">
        <h3 id="cands-title">
          Candidates <span class="muted">· in the order proposed</span>
        </h3>
        {o.candidates.length === 0 && <p class="muted">No candidate yet. The first one appears here as soon as the model proposes it.</p>}
        <ol class="op-cands">
          {o.candidates.map((c) => (
            <li key={c.id}>
              <Candidate c={c} />
            </li>
          ))}
        </ol>
      </section>
      {/* After the list, so it appends like the candidates and never pushes what the reader is looking at. */}
      <AcceptPanel />
    </div>
  );
}

/** The Tested-only path: why there is no proof or SMT stage, and what the one tier means here. */
function TestedOnlyPanel() {
  const { store } = useApp();
  const s = store.state.value;
  const t = s.tested!;
  return (
    <section class="panel quiet stack op-tested" aria-labelledby="tested-title">
      <p class="label" id="tested-title">
        {TIER_LABEL.tested} tier only
      </p>
      <p>
        <code>{s.fn}</code> is outside the verifiable subset (refusal <code>{t.refusal.code}</code>, line {t.refusal.span.line}, column {t.refusal.span.column}):{' '}
        <InlineText text={t.refusal.reason} />
      </p>
      <p>
        No spec, Lean proof or SMT check exists for it, so those stages are skipped for every candidate. Your original is the reference: each candidate is
        compared with it on inputs generated from <code>{t.signature}</code> (integers and non-integer numbers
        {t.specials ? '; NaN, Infinity, -Infinity and -0 included, as you chose' : '; NaN, Infinity and -0 not generated'}). NaN counts as equal to NaN; -0 and 0
        count as different. The highest tier a candidate can reach is {TIER_LABEL.tested}.
      </p>
    </section>
  );
}

/** "Tested on 1,000 generated inputs": the Tested label with its N (the differential inputs compared). */
export function TestedTierLine({ c }: { c: CandidateRecord }) {
  const dd = differentialDetail(c);
  return (
    <span class="tier tier-tested">
      <span class="tier-label">{TIER_LABEL.tested}</span>
      {dd && (
        <span class="tier-sentence">
          {' '}
          on <Num what={`Differential stage of candidate ${c.id}: inputs generated from the signature and compared with the original (seed ${dd.seed})`}>{formatCount(dd.compared)} generated inputs</Num>
        </span>
      )}
    </span>
  );
}

/** Stages skipped for every candidate of a Tested-only session, with the server's reason. */
function SkippedStages({ c }: { c: CandidateRecord }) {
  const skipped = c.stages.filter((x) => x.status === 'skipped');
  if (!skipped.length) return null;
  return (
    <p class="muted fx-small op-skipped">
      {skipped.map((x) => STAGE_LABEL[x.stage]).join(' and ')}: skipped ({skipped[0]!.summary.startsWith('outside the verifiable subset') ? 'outside the verifiable subset' : skipped[0]!.summary}).
    </p>
  );
}

function Header() {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const o = s.optimize;
  const running = o.stoppedBy === null;
  return (
    <section class="op-head panel quiet stack" aria-label="Threshold and baseline">
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <p>{o.threshold ? <Num what="Threshold chosen when optimization started">{thresholdWords(o.threshold)}</Num> : 'No threshold recorded.'}</p>
        {running ? (
          <ActionButton keyName="x" whileBusy run={() => adapter.stopOptimize()}>
            Stop
          </ActionButton>
        ) : (
          <span class="muted">Stopped.</span>
        )}
      </div>
      <BaselineLine baseline={o.baseline} />
      {running && (
        <p class="muted fx-small" role="status" aria-live="polite">
          Running ·{' '}
          <Num what="Candidates proposed so far">
            {formatCount(o.candidates.length)} candidate{o.candidates.length === 1 ? '' : 's'}
          </Num>{' '}
          so far. New candidates are added at the end of the list.
          {o.incumbentId === null && ' No current best yet: until a candidate passes every check, the original stands.'}
        </p>
      )}
    </section>
  );
}

function BaselineLine({ baseline }: { baseline: BenchSummary | null }) {
  if (!baseline) return <p class="muted">No benchmark of the original is recorded, so no candidate can be called faster.</p>;
  return (
    <p>
      Original:{' '}
      <Num what={`Baseline benchmark of the original, ${formatCount(baseline.trials)} trials, ${baseline.distribution}`}>{nsText(baseline.median)}</Num>{' '}
      <span class="muted">
        (<Num what={`Bootstrap interval of the baseline median, ${formatCount(baseline.trials)} trials`}>{ciText(baseline.lo, baseline.hi)}</Num>)
      </span>{' '}
      on the declared distribution: {baseline.distribution}
      {baseline.sizes.length > 0 && (
        <>
          {' '}
          (sizes <Num what="Input sizes of the declared distribution, calibrated from the original">{baseline.sizes.join(', ')}</Num>)
        </>
      )}
      . Every speedup below is measured against this, the original.
    </p>
  );
}

/** The benchmark readout, versus the ORIGINAL. Always with the 95% CI; "faster" only when `canSayFaster` (significant, interval prints above 1). */
export function BenchReadout({ c }: { c: CandidateRecord }) {
  const b = c.bench;
  const v = verdictText(c);
  if (!b) {
    const st = stageOf(c, 'benchmark');
    return <p class="op-bench muted">{st?.status === 'running' ? 'Benchmark running.' : st?.status === 'skipped' || c.outcome === 'rejected' ? 'Not benchmarked.' : 'Not benchmarked yet.'}</p>;
  }
  return (
    <div class={`op-bench op-bench-${v.verdict}`}>
      <p>
        Median <Num what={`Benchmark of candidate ${c.id}: ${formatCount(b.trials)} trials, ${b.distribution}`}>{nsText(b.median)}</Num>{' '}
        <span class="muted">
          (<Num what={`Bootstrap interval of candidate ${c.id}'s median, ${formatCount(b.trials)} trials`}>{ciText(b.lo, b.hi)}</Num>)
        </span>
        {c.speedup && (
          <>
            {' '}
            · speedup vs the original <Num what="Original median divided by candidate median, on the declared distribution">{ratioText(c.speedup)}</Num>{' '}
            <span class="muted">
              (<Num what="Bootstrap interval of the speedup ratio vs the original">{speedupCiText(c.speedup)}</Num>)
            </span>
          </>
        )}
      </p>
      <p class="op-bench-verdict">{v.text}</p>
    </div>
  );
}

function IncumbentPanel() {
  const { store } = useApp();
  const s = store.state.value;
  const inc = incumbent(s);
  const mc = inc ? candidateModelCheck(s, inc.id) : null;
  // No incumbent: one quiet line, so the first candidates (and a catch) are not pushed below the fold by an empty panel.
  if (!inc) return null; // said in the header's status line instead
  return (
    <section class="panel stack op-incumbent" aria-labelledby="inc-title">
      <p class="label" id="inc-title">
        Current best
      </p>
      {inc ? (
        <>
          <div class="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h3>
              Candidate {inc.id} <span class="muted">· round {inc.round}</span>
            </h3>
            {s.tested && inc.tier === 'tested' ? <TestedTierLine c={inc} /> : inc.tier && <TierBadge tier={inc.tier} n={mc?.inputs ?? null} mismatches={mc?.disagreements} k={smtK(inc)} />}
          </div>
          {inc.outcome === 'accepted-at-verified' && (
            <p class="op-accepted-note">
              <ProvText text={`Accepted by you at ${verifiedLabel(smtK(inc))}. Not proved.`} tokens={kTokens(inc)} />
            </p>
          )}
          <BenchReadout c={inc} />
        </>
      ) : (
        <p class="muted">None yet. Until a candidate passes every check, the original stands.</p>
      )}
    </section>
  );
}

function AcceptPanel() {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const marked = s.optimize.candidates.filter((c) => c.outcome === 'faster-not-proved');
  const open = marked.filter((c) => acceptBlocker(c) === null);
  const blocked = marked.filter((c) => acceptBlocker(c) !== null);
  const [picked, setPicked] = useState<number | null>(null);
  if (!marked.length) return null;
  const chosen = open.find((c) => c.id === picked) ?? open.at(-1) ?? null;
  const inc = incumbent(s);
  return (
    <section class="panel stack op-accept" aria-labelledby="accept-title">
      <h3 id="accept-title">Faster, not proved</h3>
      <p>
        {marked.length === 1 ? `Candidate ${marked[0]!.id} was` : 'These candidates were'} faster than the current best when checked, but Lean did not accept a
        proof against the agreed spec.{' '}
        {open.length > 0 ? 'One that passed the bounded SMT check may be accepted at that tier.' : 'None of them passed the bounded SMT check, so none can be accepted.'}
      </p>
      {blocked.map((c) => (
        <p key={c.id} class="muted">
          {acceptBlocker(c)}
        </p>
      ))}
      {chosen && open.length > 1 && (
        <fieldset class="fx-choices">
          <legend class="sr-only">Candidate to accept</legend>
          {open.map((c) => (
            <label key={c.id} class={`fx-choice${c.id === chosen.id ? ' on' : ''}`}>
              <input type="radio" name="accept-pick" checked={c.id === chosen.id} onChange={() => setPicked(c.id)} />
              <span class="fx-choice-body">
                <span class="fx-choice-title">Candidate {c.id}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {chosen && (
        <>
          <div class="op-consequence">
            <p class="label">If you accept</p>
            {acceptConsequence(chosen, inc).map((t) => (
              <p key={t}>
                <ProvText text={t} tokens={kTokens(chosen)} />
              </p>
            ))}
          </div>
          <div>
            <ActionButton keyName="a" run={() => adapter.acceptFasterNotProved(chosen.id)}>
              Accept candidate {chosen.id} without a proof
            </ActionButton>
          </div>
        </>
      )}
    </section>
  );
}

function Final() {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const r = finalReadout(s, paramNames(s));
  if (!r) return null;
  const inc = r.incumbent;
  const mc = inc ? candidateModelCheck(s, inc.id) : null;
  return (
    <section class="panel stack op-final" aria-labelledby="final-title">
      <h3 id="final-title">Stopped: {r.stoppedWords}.</h3>
      <dl class="kv">
        <dt>Delivered candidate</dt>
        <dd>
          {inc ? (
            <span class="fx-stack-s">
              <span>Candidate {inc.id}</span>
              {s.tested && inc.tier === 'tested' ? <TestedTierLine c={inc} /> : inc.tier && <TierBadge tier={inc.tier} n={mc?.inputs ?? null} mismatches={mc?.disagreements} k={smtK(inc)} />}
            </span>
          ) : s.tested ? (
            'None. The original stands; delivery records what was tried and claims nothing.'
          ) : (
            'None. The original stands; delivery contains the proof work only.'
          )}
        </dd>
        <dt>Speedup vs the original</dt>
        <dd>
          {inc?.speedup ? (
            <>
              <Num what="Original median divided by candidate median">{ratioText(inc.speedup)}</Num>{' '}
              <span class="muted">
                (<Num what="Bootstrap interval of the speedup ratio">{speedupCiText(inc.speedup)}</Num>)
              </span>
              <span class="muted"> · {verdictText(inc).text}</span>
            </>
          ) : (
            <span class="muted">None recorded.</span>
          )}
        </dd>
        <dt>Candidates tried</dt>
        <dd>
          <Num what="Candidates the model proposed in this run">{formatCount(r.tried)}</Num>
        </dd>
      </dl>
      {r.rows.length > 0 && (
        <ul class="op-readout-rows">
          {r.rows.map((row) => (
            <li key={row.id}>
              <b>Candidate {row.id}.</b> <InlineText text={row.text} />
            </li>
          ))}
        </ul>
      )}
      {!s.delivery ? (
        <div class="stack">
          <p class="muted">
            {s.tested ? (
              <>
                Delivery writes files under <code>.faithful/{s.fn}/</code>: the patch, provenance and how to re-run the differential. There is no spec or Lean file:
                none exists for this function. Your source file is not modified.
              </>
            ) : (
              <>
                Delivery writes files under <code>.faithful/{s.fn}/</code>: the patch, the spec, the Lean file, provenance and how to verify it. Your source file is
                not modified.
              </>
            )}
          </p>
          <div>
            <ActionButton primary keyName="d" run={() => adapter.deliver()}>
              Write the delivery
            </ActionButton>
          </div>
        </div>
      ) : (
        <p class="muted">
          Delivered to <code>{s.delivery.dir}</code>. Press <KeyHint keys={['→', ']']} /> to see it.
        </p>
      )}
    </section>
  );
}

function Candidate({ c }: { c: CandidateRecord }) {
  const { store } = useApp();
  const s = store.state.value;
  const mc = candidateModelCheck(s, c.id);
  const n = nForCandidate(s, c);
  const proofs = candidateProofCalls(s, store.events.value, c).map((call, i) => (
    <ModelSaw key={call.id} call={call} what={`candidate ${c.id}, proof attempt ${i + 1}`} />
  ));
  const dd = differentialDetail(c);
  const slow = dd?.skippedSlow ?? 0;
  if (c.outcome === 'rejected' && c.rejection) {
    return (
      <div class="stack op-cand-rejected">
        <CatchCard candidate={c} params={paramNames(s)} modelChecked={n} call={callById(s, c.callId)}>
          <Funnel stages={c.stages} label={`Checks for candidate ${c.id}`} decided />
        </CatchCard>
        {proofs.length > 0 && <div>{proofs}</div>}
      </div>
    );
  }
  const k = smtK(c);
  return (
    <section class={`panel stack op-cand op-cand-${c.outcome}`} aria-label={`Candidate ${c.id}`}>
      <div class="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h4>
          Candidate {c.id} <span class="muted">· round {c.round} · {OUTCOME_WORDS[c.outcome]}</span>
        </h4>
        {s.tested && c.tier === 'tested' ? <TestedTierLine c={c} /> : c.tier && <TierBadge tier={c.tier} n={n} mismatches={mc?.disagreements} k={k} />}
      </div>
      <Funnel stages={c.stages} label={`Checks for candidate ${c.id}`} decided={c.outcome !== 'running'} />
      {s.tested && <SkippedStages c={c} />}
      {slow > 0 && (
        <p class="muted fx-small">
          <Num what={`Differential stage of candidate ${c.id}: generated inputs not compared`}>{formatCount(slow)}</Num> generated input{slow === 1 ? ' was' : 's were'}{' '}
          skipped: the original takes more than 100 ms on {slow === 1 ? 'it' : 'them'}.
        </p>
      )}
      {c.outcome === 'faster-not-proved' && (
        <p class="muted">
          {c.stages.find((x) => x.stage === 'proof')?.status === 'skipped'
            ? 'Faster, not proved: no proof was attempted, because this candidate has no Lean model.'
            : 'Faster, not proved: Lean did not accept a proof against the agreed spec.'}{' '}
          Not delivered unless you accept it.
        </p>
      )}
      {c.outcome === 'accepted-at-verified' && (
        <p class="op-accepted-note">
          <ProvText text={`Accepted by you at ${verifiedLabel(k)}. Not proved; delivery marks it.`} tokens={kTokens(c)} />
        </p>
      )}
      {c.outcome === 'not-faster' && c.rejection?.reason && (
        <p>
          <InlineText text={c.rejection.reason} />
        </p>
      )}
      <BenchReadout c={c} />
      {/* The tier badge above already prints provedSentence(N); the evidence note would repeat it word for word. */}
      {c.outcome !== 'running' && <Evidence state={s} candidate={c} provedNote={!(c.tier && n !== null)} />}
      <details class="saw">
        <summary>Candidate source</summary>
        <Code text={c.source} lang="ts" label={`Source of candidate ${c.id}`} />
      </details>
      <ModelSaw call={callById(s, c.callId)} what={`candidate ${c.id}`} />
      {proofs}
    </section>
  );
}

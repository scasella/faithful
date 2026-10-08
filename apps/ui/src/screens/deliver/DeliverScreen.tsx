/**
 * Deliver, laid out as a receipt: the statement that the user's file was not modified; the title and label; when
 * carve-outs exist, a dominant band listing them verbatim BEFORE any speedup; the speedup with its 95% CI; the claim
 * (label with provedSentence(N), theorem statement, axioms, attempts, and the evidence line computed from the session
 * facts the way the server's delivery does); the evidence by gate; "Left on the table" (faster candidates that were not
 * proved, with their labels and reasons); the files written under .faithful/<fn>/, a diff view of the change, and the
 * exact commands of VERIFY.md as copyable blocks.
 *
 * SessionState records the delivery's directory and file names, not their contents. The diff shown here is computed in
 * the page from the two sources the session carries and is labeled as such; the patch file on disk is what you apply.
 */
import { Fragment } from 'preact';
import type { CandidateRecord, SessionState } from '@faithful/session';
import { useApp } from '../../app/AppContext';
import { CarveOutBand, carveOutsOf } from '../../components/CarveOutBand';
import { CopyBlock } from '../../components/CopyBlock';
import { GATE_LABEL, gateNote } from '../../components/gates';
import { InlineText } from '../../components/InlineText';
import { Num } from '../../components/Provenance';
import { Evidence } from '../../components/Evidence';
import { TierBadge } from '../../components/TierBadge';
import { candidateModelCheck, incumbent, mutationOf, nForCandidate, originalModelCheck, proofDetail, smtK, stageOf } from '../../lib/facts';
import { ratioText, speedupCiText } from '../../lib/format';
import { verdictText } from '../optimize/speed';
import { deliveryCommands, describeFile, hunks, joinPath, lineDiff, notModifiedSentence } from './deliverModel';
import { originalProof } from '../prove/proveModel';
import { TIER_LABEL, formatCount } from '@faithful/core/tiers';
import { TestedTierLine } from '../optimize/OptimizeScreen';
import './deliver.css';

export function DeliverScreen() {
  const { store } = useApp();
  const s = store.state.value;
  const d = s.delivery;
  const changeDelivered = !!incumbent(s) && !!s.file;
  if (!d) {
    return (
      <div class="stack-l dl-screen">
        <p class="dl-not-modified">{notModifiedSentence(s.file)}</p>
        <p class="muted">Nothing has been delivered yet. Delivery is written from the Optimize screen once optimizing has stopped.</p>
      </div>
    );
  }
  return (
    <div class="stack-l dl-screen">
      <p class="dl-not-modified" role="note">
        {notModifiedSentence(s.file)}
      </p>
      <Delivered s={s} />
      <LeftOnTheTable s={s} />
      <section class="stack" aria-labelledby="files-title">
        <h3 id="files-title">Delivered · your source is untouched</h3>
        <p class="muted">
          Under <code>{d.dir}</code> at {d.at}.
        </p>
        <ul class="dl-files">
          {d.files.map((f) => {
            const what = describeFile(f, s.fn, changeDelivered);
            return (
              <li key={f}>
                <code>{joinPath(d.dir, f)}</code>
                {what && <span class="dl-file-what">{what}</span>}
              </li>
            );
          })}
        </ul>
      </section>
      <DiffSection s={s} />
      <section class="stack" aria-labelledby="cmds-title">
        <h3 id="cmds-title">Don't trust this page. Re-check it, then apply it</h3>
        <p class="muted">
          Run these in your repository, as <code>{joinPath(d.dir, 'VERIFY.md')}</code> gives them. Re-checking does not trust this page or the model.
          {!changeDelivered && (incumbent(s) ? ' The function was pasted, so there is no file to patch.' : ' No change was delivered, so there is nothing to apply.')}
        </p>
        {deliveryCommands(d, changeDelivered, !!s.tested, !!incumbent(s)).map((c, i) => (
          <div key={c.cmd} class="fx-stack-s">
            <p>{c.what}</p>
            <CopyBlock text={c.cmd} keyName={String(i + 1)} label={`Command: ${c.what}`} />
          </div>
        ))}
      </section>
    </div>
  );
}

function Delivered({ s }: { s: SessionState }) {
  const inc = incumbent(s);
  const mc = originalModelCheck(s);
  const p = originalProof(s);
  if (s.tested) {
    // A refused function: the one claim possible is Tested. Never a proof or SMT line.
    return (
      <section class="stack" aria-labelledby="dl-title">
        <h3 id="dl-title">{inc ? `Delivered: candidate ${inc.id}` : 'No candidate delivered'}</h3>
        <p>
          {TIER_LABEL.tested} tier only: <code>{s.fn}</code> is outside the verifiable subset (refusal <code>{s.tested.refusal.code}</code>), so no spec, proof or SMT
          claim exists for it.
          {inc ? ' The evidence below is everything that is claimed.' : ' No candidate was kept, so there is no change to apply and nothing is claimed.'}
        </p>
        {inc && (
          <>
            <TestedTierLine c={inc} />
            <Evidence state={s} candidate={inc} />
          </>
        )}
      </section>
    );
  }
  if (!inc) {
    return (
      <section class="stack" aria-labelledby="dl-title">
        <h3 id="dl-title">No candidate delivered</h3>
        <p>No candidate was kept, so there is no change to apply. The delivery holds the agreed spec{p ? ' and the proof work on the original' : ''}.</p>
        <CarveOutBand state={s} receipt />
        {p && (p.result === 'proved' || p.result === 'proved-trusting-compiler') && (
          <div>
            <p class="label">The original against the agreed spec</p>
            <TierBadge tier={p.result} n={mc?.inputs ?? null} mismatches={mc?.disagreements} />
          </div>
        )}
      </section>
    );
  }
  const n = nForCandidate(s, inc);
  const cmc = candidateModelCheck(s, inc.id);
  const pd = proofDetail(inc);
  const statement = typeof pd?.statement === 'string' ? pd.statement : null;
  const carves = carveOutsOf(s).length;
  const m = mutationOf(inc);
  return (
    <section class="stack dl-receipt" aria-labelledby="dl-title">
      <p class="dl-kicker">
        Receipt · <code>{s.delivery!.dir}</code> · {s.delivery!.at.slice(0, 10)}
      </p>
      <div class="dl-title-row">
        <h3 id="dl-title">Delivered: candidate {inc.id} replaces the original</h3>
        {carves > 0 && (
          <span class="dl-carve-count">
            {carves === 1 ? 'one carve-out limits this label' : `${formatCount(carves)} carve-outs limit this label`}: read below
          </span>
        )}
      </div>
      {inc.tier && <TierBadge tier={inc.tier} n={n} mismatches={cmc?.disagreements} k={smtK(inc)} />}
      {inc.outcome === 'accepted-at-verified' && <p class="op-accepted-note">You accepted this candidate below the proof tier. The delivery marks it as not proved.</p>}
      <CarveOutBand state={s} receipt />
      {inc.speedup && (
        <div class="dl-speed">
          <p>
            <span class="dl-speed-x">
              <Num what="Original median divided by candidate median, on the declared distribution">{ratioText(inc.speedup)}</Num>
            </span>{' '}
            <span class="muted dl-speed-ci">
              (<Num what="Bootstrap interval of the speedup ratio vs the original">{speedupCiText(inc.speedup)}</Num>)
            </span>
          </p>
          <p class="muted fx-small">
            {verdictText(inc).text}
            {inc.bench && (
              <>
                {' '}
                {inc.bench.distribution} · <Num what="Benchmark trials of the delivered candidate">{formatCount(inc.bench.trials)} trials</Num>.
              </>
            )}
          </p>
          {carves > 0 && (
            <p class="dl-speed-carve" role="note">
              The benchmark drew its inputs from this distribution without applying the carve-outs, so the speedup may have been measured on
              inputs the label does not cover.
            </p>
          )}
        </div>
      )}
      <section class="dl-claim stack" aria-labelledby="dl-claim-h">
        <h4 class="label" id="dl-claim-h">
          The claim
        </h4>
        <Evidence state={s} candidate={inc} />
        {statement && (
          <div>
            <p class="dl-sub">Theorem, as Lean checked it</p>
            <pre class="dl-theorem" tabIndex={0} aria-label="Theorem statement">
              <code>{statement}</code>
            </pre>
          </div>
        )}
        {pd && (
          <p class="muted fx-small">
            Axioms: {pd.axioms.length ? pd.axioms.join(', ') : 'none'} · <Num what="Proof attempts of the delivered candidate">{formatCount(pd.attempts)} {pd.attempts === 1 ? 'attempt' : 'attempts'}</Num>
          </p>
        )}
      </section>
      <GateEvidence c={inc} />
      {m && m.caught * 2 < m.total && (
        <p class="muted fx-small dl-weak">
          Only <Num what="Mutation check of the differential inputs">{formatCount(m.caught)} of {formatCount(m.total)}</Num> broken copies of the original were caught by the differential inputs: those inputs are weak for
          this function, which limits what the differential test means.
        </p>
      )}
    </section>
  );
}

/** Evidence by gate: each stage's own summary (cut to its first clause when long), in the order a candidate meets them. */
function GateEvidence({ c }: { c: CandidateRecord }) {
  const rows = (['differential', 'smt', 'benchmark', 'proof'] as const).map((id) => stageOf(c, id)).filter((r): r is NonNullable<typeof r> => !!r);
  if (!rows.length) return null;
  return (
    <section class="dl-gates" aria-labelledby="dl-gates-h">
      <h4 class="label" id="dl-gates-h">
        Evidence, by gate
      </h4>
      <dl>
        {rows.map((r) => (
          <div key={r.stage}>
            <dt>{GATE_LABEL[r.stage]}</dt>
            <dd>
              <Num what={`${GATE_LABEL[r.stage]} stage of candidate ${c.id}, as the server recorded it`}>{gateNote(r)}</Num>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Faster candidates that were not proved: shown with their own labels and reasons, never delivered under a stronger one. */
function LeftOnTheTable({ s }: { s: SessionState }) {
  const inc = incumbent(s);
  const left = s.optimize.candidates.filter((c) => c.outcome === 'faster-not-proved' && c.id !== inc?.id);
  if (!left.length) return null;
  return (
    <section class="stack dl-left" aria-labelledby="dl-left-h">
      <h3 id="dl-left-h">Left on the table</h3>
      <ul class="dl-left-list">
        {left.map((c) => (
          <li key={c.id}>
            <div class="dl-left-head">
              <b>Candidate {c.id}</b>
              {s.tested && c.tier === 'tested' ? <TestedTierLine c={c} /> : c.tier && <TierBadge tier={c.tier} n={nForCandidate(s, c)} k={smtK(c)} />}
              {c.speedup && (
                <span class="dl-left-speed">
                  <Num what={`Speedup of candidate ${c.id} vs the original, on the declared distribution`}>{ratioText(c.speedup)}</Num> (
                  <Num what="Bootstrap interval of the speedup ratio vs the original">{speedupCiText(c.speedup)}</Num>)
                </span>
              )}
            </div>
            {c.rejection?.reason && (
              <p class="dl-left-why">
                <Num what={`Recorded by the server for candidate ${c.id}`}>
                  <InlineText text={c.rejection.reason} />
                </Num>
              </p>
            )}
          </li>
        ))}
      </ul>
      <p class="muted fx-small">Faster candidates that were not proved are never delivered under a stronger label.</p>
    </section>
  );
}

function DiffSection({ s }: { s: SessionState }) {
  const inc = incumbent(s);
  if (!inc || !s.delivery) return null;
  const ops = lineDiff(s.source, inc.source);
  const hs = hunks(ops);
  const patchFile = s.delivery.files.find((f) => /\.(diff|patch)$/.test(f));
  const name = s.file || `${s.fn}.ts`;
  return (
    <section class="stack" aria-labelledby="diff-title">
      <h3 id="diff-title">The change</h3>
      <p class="muted">
        Original <code>{s.fn}</code> → candidate {inc.id}. Computed in this page from the sources recorded in the session
        {patchFile ? (
          <>
            ; the file you apply is <code>{joinPath(s.delivery.dir, patchFile)}</code>, whose line numbers refer to the whole file.
          </>
        ) : (
          '.'
        )}
      </p>
      {hs.length === 0 ? (
        <p>The candidate's source is identical to the original's.</p>
      ) : (
        <pre class="dl-diff" tabIndex={0} aria-label={`Diff of ${s.fn}: original to candidate ${inc.id}`}>
          <code>
            <span class="dl-d-file">--- a/{name}</span>
            {'\n'}
            <span class="dl-d-file">+++ b/{name}</span>
            {'\n'}
            {hs.map((h) => (
              <Fragment key={h.header}>
                <span class="dl-d-hunk">{h.header}</span>
                {'\n'}
                {h.ops.map((o, i) => (
                  <span key={i} class={`dl-d-line dl-d-${o.kind}`}>
                    <span class="dl-d-sign" aria-hidden="true">
                      {o.kind === 'same' ? ' ' : o.kind === 'del' ? '-' : '+'}
                    </span>
                    <span class="sr-only">{o.kind === 'del' ? 'removed: ' : o.kind === 'add' ? 'added: ' : ''}</span>
                    {o.text}
                    {'\n'}
                  </span>
                ))}
              </Fragment>
            ))}
          </code>
        </pre>
      )}
    </section>
  );
}

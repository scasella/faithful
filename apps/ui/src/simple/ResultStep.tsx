/**
 * Step 6, Result. As on the other steps: the carve-outs verbatim first, then the label they limit (with its Proved
 * sentence), then the speedup with its 95% CI ("faster" only through canSayFaster / verdictText), then one button: "Get
 * the patch" when a change is delivered, "Write the evidence files" otherwise. Once delivered: your source is untouched,
 * the files written, and the exact commands of VERIFY.md (`faithful verify .faithful/<fn>`, and `git apply …` when a
 * change was delivered) with copy buttons.
 */
import type { SessionState } from '@faithful/session';
import { useApp } from '../app/AppContext';
import { carveOutsOf } from '../components/CarveOutBand';
import { CopyBlock } from '../components/CopyBlock';
import { Evidence } from '../components/Evidence';
import { incumbent, paramNames } from '../lib/facts';
import { canSayFaster, ratioText, speedupCiText } from '../lib/format';
import { deliveryCommands, describeFile, joinPath, notModifiedSentence } from '../screens/deliver/deliverModel';
import { finalReadout, verdictText } from '../screens/optimize/speed';
import { formatCount } from '@faithful/core/tiers';
import { AcceptOffer, CandidateLabel, OriginalLabel, TestedRanWith } from './FasterStep';
import { Actions, CarveOuts, DELIVERED_ID, Details, SButton, StepHead } from './parts';

export function ResultStep({ onPickAnother }: { onPickAnother?(): void } = {}) {
  const { store, adapter } = useApp();
  const s = store.state.value;
  const inc = incumbent(s);
  const r = finalReadout(s, paramNames(s));
  const changeDelivered = !!inc && !!s.file;
  const sp = inc?.speedup ?? null;
  const carves = carveOutsOf(s).length;
  return (
    <section class="s-step">
      <StepHead lead={r ? `Stopped: ${r.stoppedWords}. ${formatCount(r.tried)} candidate${r.tried === 1 ? '' : 's'} tried.` : undefined}>
        {inc ? `Candidate ${inc.id} replaces the original` : 'The original stands'}
      </StepHead>

      {/* as on every other step: the carve-outs first, then the label they limit, then the speedup */}
      <CarveOuts s={s} />
      <div class="s-result-label">{inc ? <CandidateLabel s={s} c={inc} /> : <OriginalLabel s={s} />}</div>
      {inc?.outcome === 'accepted-at-verified' && <p class="s-body">You accepted this candidate below the proof tier. The delivery marks it as not proved.</p>}

      {inc && sp && (
        <div class="s-speed">
          <p class="s-speed-x">
            {ratioText(sp)}
            {canSayFaster(sp) ? ' faster' : ''}
          </p>
          <p class="s-speed-ci">{speedupCiText(sp)} · {verdictText(inc).text}</p>
          {carves > 0 && (
            <p class="s-note">
              The benchmark drew its inputs without applying the carve-outs, so the speedup may have been measured on inputs the label does not cover.
            </p>
          )}
        </div>
      )}
      {!inc && <p class="s-body">No candidate was kept, so there is no change to apply.</p>}
      {/* on the Tested tier: what ran as the original (the extracted unit, or the whole file), as VERIFY.md says it */}
      {s.tested && <TestedRanWith s={s} />}

      {!s.delivery ? (
        <>
          <Actions note={<>Writes files under <code>.faithful/{s.fn}/</code>. Your source file is not modified.</>}>
            {/* "patch" only when a change is delivered (a kept candidate of a repository file): otherwise the delivery is
                the evidence files and VERIFY.md, with no git apply */}
            <SButton primary run={() => adapter.deliver()}>
              {changeDelivered ? 'Get the patch' : 'Write the evidence files'}
            </SButton>
            {onPickAnother && (
              <SButton local run={onPickAnother}>
                Pick another function
              </SButton>
            )}
          </Actions>
          <AcceptOffer s={s} />
        </>
      ) : (
        <>
          <Delivered s={s} changeDelivered={changeDelivered} />
          {onPickAnother && (
            <Actions errorJobs={[]}>
              <SButton local run={onPickAnother}>
                Pick another function
              </SButton>
            </Actions>
          )}
        </>
      )}

      {inc && (
        <Details summary="Evidence">
          {/* its own claim container: the evidence line says "Proved" with provedSentence(N) right beneath it */}
          <section class="evidence-wrap" aria-label="Evidence">
            <Evidence state={s} candidate={inc} />
          </section>
          {r && r.rows.length > 0 && (
            <ul class="s-plain">
              {r.rows.map((row) => (
                <li key={row.id}>
                  Candidate {row.id}. {row.text}
                </li>
              ))}
            </ul>
          )}
        </Details>
      )}
    </section>
  );
}

function Delivered({ s, changeDelivered }: { s: SessionState; changeDelivered: boolean }) {
  const d = s.delivery!;
  return (
    <div class="s-delivered" id={DELIVERED_ID} tabIndex={-1}>
      <p class="s-body">{notModifiedSentence(s.file, changeDelivered)}</p>
      <ul class="s-files" aria-label="Delivered files">
        {d.files.map((f) => {
          const what = describeFile(f, s.fn, changeDelivered);
          return (
            <li key={f}>
              <code>{joinPath(d.dir, f)}</code>
              {what && <span class="s-file-what">{what}</span>}
            </li>
          );
        })}
      </ul>
      {deliveryCommands(d, changeDelivered, !!s.tested, !!incumbent(s)).map((c) => (
        <div key={c.cmd} class="s-cmd">
          <p class="s-note">{c.what}</p>
          <CopyBlock text={c.cmd} label={`Command: ${c.what}`} />
        </div>
      ))}
    </div>
  );
}

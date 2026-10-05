/**
 * Deliver: the statement that the user's file was not modified, the delivered tier and evidence line (computed from the
 * session facts the way the server's delivery does: the delivered function's own model check supplies N), the files
 * written under .faithful/<fn>/, a diff view of the change, and the exact commands of VERIFY.md as copyable blocks.
 *
 * SessionState records the delivery's directory and file names, not their contents. The diff shown here is computed in
 * the page from the two sources the session carries and is labeled as such; the patch file on disk is what you apply.
 */
import { Fragment } from 'preact';
import type { SessionState } from '@faithful/session';
import { useApp } from '../../app/AppContext';
import { CopyBlock } from '../../components/CopyBlock';
import { Evidence } from '../../components/Evidence';
import { TierBadge } from '../../components/TierBadge';
import { incumbent, originalModelCheck } from '../../lib/facts';
import { deliveryCommands, describeFile, hunks, joinPath, lineDiff, notModifiedSentence } from './deliverModel';
import { originalProof } from '../prove/proveModel';
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
      <section class="stack" aria-labelledby="files-title">
        <h3 id="files-title">Files written</h3>
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
        <h3 id="cmds-title">Check it, then apply it</h3>
        <p class="muted">
          Run these in your repository, as <code>{joinPath(d.dir, 'VERIFY.md')}</code> gives them. Re-checking does not trust this page or the model.
          {!changeDelivered && (incumbent(s) ? ' The function was pasted, so there is no file to patch.' : ' No change was delivered, so there is nothing to apply.')}
        </p>
        {deliveryCommands(d, changeDelivered).map((c, i) => (
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
  if (!inc) {
    return (
      <section class="stack" aria-labelledby="dl-title">
        <h3 id="dl-title">No candidate delivered</h3>
        <p>No candidate was kept, so there is no change to apply. The delivery holds the agreed spec{p ? ' and the proof work on the original' : ''}.</p>
        {p && (p.result === 'proved' || p.result === 'proved-trusting-compiler') && (
          <div>
            <p class="label">The original against the agreed spec</p>
            <TierBadge tier={p.result} n={mc?.inputs ?? null} mismatches={mc?.disagreements} />
          </div>
        )}
      </section>
    );
  }
  return (
    <section class="stack" aria-labelledby="dl-title">
      <h3 id="dl-title">Delivered: candidate {inc.id}</h3>
      {inc.outcome === 'accepted-at-verified' && <p class="op-accepted-note">You accepted this candidate below the proof tier. The delivery marks it as not proved.</p>}
      <Evidence state={s} candidate={inc} />
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

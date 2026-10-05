/**
 * Every number the UI shows is wrapped in <Num>: hover, focus or click reveals its provenance (what was measured, the
 * date, model id and toolchain versions). Non-modal: Escape or moving away closes it; nothing else on the page is blocked.
 */
import { Fragment, type ComponentChildren } from 'preact';
import { useContext, useId, useState } from 'preact/hooks';
import type { Stamp } from '@faithful/core';
import { formatCount } from '@faithful/core/tiers';
import { provenanceRows } from '../lib/provenance';
import { StampContext } from './context';

export function ProvenanceBody({ what, stamp }: { what?: string; stamp: Stamp | null }) {
  return (
    <>
      {what && <p class="what">{what}</p>}
      <dl>
        {provenanceRows(stamp).map((r) => (
          <Fragment key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

export function Num({ children, what, stamp }: { children: ComponentChildren; what?: string; stamp?: Stamp | null }) {
  const ctx = useContext(StampContext);
  const s = stamp === undefined ? ctx : stamp;
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const shown = open || pinned;
  return (
    <span
      class="prov"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && shown) {
          e.stopPropagation();
          setOpen(false);
          setPinned(false);
        }
      }}
    >
      {/* A real inline element (not <button>, which renders as an inline-block box): a number inside a sentence wraps with
          the sentence instead of breaking it, so no orphaned "." on narrow screens. Keyboard: Tab focuses (and opens),
          Enter or Space pins, Escape closes. */}
      <span
        role="button"
        tabIndex={0}
        class="prov-trigger"
        aria-expanded={shown}
        aria-controls={id}
        aria-describedby={shown ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setPinned((p) => !p);
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setPinned(false);
        }}
      >
        {children}
      </span>
      {shown && (
        <span class="prov-pop" id={id} role="note">
          <ProvenanceBody what={what} stamp={s} />
        </span>
      )}
    </span>
  );
}

/**
 * Prose that contains measured numbers: each occurrence of a token in `tokens` (e.g. "1,000", "k=6") becomes a <Num>
 * with its provenance; the rest is plain text.
 */
export function ProvText({ text, tokens }: { text: string; tokens: Array<{ token: string; what: string }> }) {
  const live = tokens.filter((t) => t.token && text.includes(t.token));
  if (!live.length) return <>{text}</>;
  const re = new RegExp(live.map((t) => t.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const out: Array<string | preact.JSX.Element> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    const t = live.find((x) => x.token === m[0])!;
    out.push(
      <Num key={m.index} what={t.what}>
        {m[0]}
      </Num>,
    );
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** provedSentence(N), with N carrying its provenance. */
export function ProvedSentenceText({ sentence, n }: { sentence: string; n: number }) {
  return <ProvText text={sentence} tokens={[{ token: `${formatCount(n)} inputs`, what: N_WHAT }]} />;
}

export const N_WHAT = 'Inputs on which this Lean model was evaluated and agreed with its TypeScript (the model check recorded in the session)';

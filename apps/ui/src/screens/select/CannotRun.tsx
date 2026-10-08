/**
 * The parts of a pick list that come from the server's ranking: a row's plain status, the functions Faithful can't run
 * (listed apart behind a quiet toggle, greyed, with the reason, never selectable) and the one quiet scan line. Shared by
 * Select and the Simple Pick step.
 */
import { useState } from 'preact/hooks';
import { CAN_RUN_FOOTNOTE, stateWord, toggleWords, type Row, type RowState } from './runnable';
import './runnable.css';

/** A row's status, in plain words (what can be attempted). Nothing when the list has no statuses (a fixture, a replay). */
export function RowStatus({ state }: { state: RowState | null }) {
  if (!state) return null;
  const word = stateWord(state);
  const why = state.kind === 'unknown' && state.reason && state.reason !== word ? state.reason : undefined;
  return (
    <span class={`run-state run-${state.kind}`} title={why}>
      {word}
    </span>
  );
}

/** A reason with its `code` spans (the extractor and compiler quote code in backticks) rendered as code, not as literal backticks. */
export function ReasonText({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <code key={i}>{p}</code> : p))}</>;
}

/**
 * `rows`: matches Faithful can't run, with reasons (the server sends at most 200). `total`: how many there are in all
 * (the toggle says so; defaults to `rows.length`). `only`: nothing runnable matches, so they are listed right away (an
 * empty list would hide why). `available`: statuses exist at all (otherwise nothing is rendered).
 */
/** Reasons listed at first; the rest is behind "Show more", so the page does not grow by hundreds of rows when the list opens. */
export const CANNOT_PAGE = 20;

export function CannotRun({ rows, total, only, available, id }: { rows: Row[]; total?: number; only: boolean; available: boolean; id: string }) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState(1);
  if (!available) return null;
  const count = Math.max(total ?? rows.length, rows.length);
  const shown = only || open;
  const listed = rows.slice(0, pages * CANNOT_PAGE);
  return (
    <div class="run-cannot">
      {only && count > 0 && <p class="run-note">No function Faithful can run matches. These match, and why each can't run:</p>}
      {!only && count > 0 && (
        <button type="button" class="run-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {toggleWords(count, open)}
        </button>
      )}
      {shown && count > 0 && rows.length === 0 && (
        <p class="run-note" role="status">
          Loading the list…
        </p>
      )}
      {shown && rows.length > 0 && (
        <ul id={id} class="run-list" aria-label="Functions Faithful can't run">
          {listed.map((r) => (
            <li key={`${r.hit.path}:${r.hit.name}:${r.hit.line}`} aria-disabled="true">
              <span class="run-name">{r.hit.name}</span>
              <span class="run-path">
                {r.hit.path}:{r.hit.line}
              </span>
              <span class="run-reason">{r.state?.kind === 'none' ? <ReasonText text={r.state.reason} /> : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {shown && rows.length > listed.length && (
        <button type="button" class="run-toggle" onClick={() => setPages(pages + 1)}>
          Show {Math.min(CANNOT_PAGE, rows.length - listed.length).toLocaleString('en-US')} more ({(rows.length - listed.length).toLocaleString('en-US')} left)
        </button>
      )}
      {shown && rows.length > 0 && count > rows.length && listed.length === rows.length && <p class="run-note">The first {rows.length.toLocaleString('en-US')} of them are listed.</p>}
      <p class="run-foot">{CAN_RUN_FOOTNOTE}</p>
    </div>
  );
}

/**
 * The scan's progress, quietly: ONE visible line while a pass has files left. Plain text, deliberately not a live
 * region: a counter that changes every second would be read out every second. `ScanAnnouncer` is the screen-reader side.
 */
export function ScanLine({ line }: { line: string | null }) {
  return line ? <p class="run-scan">{line}</p> : null;
}

/**
 * The screen-reader line about the scan: its text changes only when the progress line appears and when it goes (never
 * per tick). Rendered once, at a fixed place outside the list's branches, so it stays one live region for the page's life.
 * Nothing when statuses do not exist (`active` false).
 */
export function ScanAnnouncer({ text, active }: { text: string; active: boolean }) {
  if (!active) return null;
  return (
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}

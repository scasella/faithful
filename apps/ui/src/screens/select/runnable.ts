/**
 * The pick lists' rows, words and selection, from what the SERVER says Faithful can attempt (`Actions.pickFunctions`,
 * packages/cli/src/flow/scan.ts: it ranks every exported function of the repository from a background scan). Pure helpers
 * plus the selection hook; the hook that asks the server (debounce, scan polling, re-ask on focus) is in ./pickView.ts.
 *
 * Nothing here ranks: the server's order is the order. A status describes what can be attempted, never a result, so
 * these words are plain muted text and never styled like a tier. A row that is still being checked is not a choice yet:
 * it is never highlighted by default, never reached with the arrow keys and never opened (`openable`).
 */
import { useEffect, useState } from 'preact/hooks';
import type { PickResult, PickRow, ScanStatus } from '../../actions';
import { nameHitsFor, type FnHit } from './match';

/**
 * Why a function is 'unknown', told apart by the server's reason (packages/cli/src/flow/triage.ts `unknownCause`):
 * 'pending' (the scan has not reached it), 'slow' (checking took longer than the per-function cap; not run, not retried
 * while the file is unchanged) or 'failed' (the check itself failed).
 */
export type UnknownCause = 'pending' | 'slow' | 'failed';

export function unknownCause(reason: string | null): UnknownCause {
  if (reason?.startsWith('Checking took longer than')) return 'slow';
  if (reason?.startsWith('The check itself failed')) return 'failed';
  return 'pending';
}

export type RowState =
  | { kind: 'provable' }
  | { kind: 'tested' }
  /** The scan has not reached it yet and is still running. */
  | { kind: 'checking' }
  /** Not decided, and no scan is working on it right now (`reason`: the server's words). */
  | { kind: 'unknown'; reason: string | null }
  | { kind: 'none'; reason: string };

export interface Row {
  hit: FnHit;
  /** null: no status (a fixture or a replay: every function is listed as before, without one). */
  state: RowState | null;
}

/** A server row as the lists show it. `query`: the one the server matched with (for the emphasis of the name). */
export function pickRow(r: PickRow, query: string, scanning: boolean): Row {
  const hit: FnHit = { path: r.file, name: r.name, line: r.line, hasJsDoc: r.hasJsDoc, nameHits: nameHitsFor(query, r.name, r.file) };
  switch (r.tier) {
    case 'provable':
      return { hit, state: { kind: 'provable' } };
    case 'tested':
      return { hit, state: { kind: 'tested' } };
    case 'none':
      return { hit, state: { kind: 'none', reason: r.reason ?? 'Faithful cannot run this function.' } };
    case 'unknown':
      return { hit, state: scanning && unknownCause(r.reason) === 'pending' ? { kind: 'checking' } : { kind: 'unknown', reason: r.reason } };
  }
}

/**
 * Can the person open this row? Not while it is still being checked (the scan has not decided it, and the list is about to
 * be re-ranked): the highlight and a click would land on a function chosen by position, not by the person. A row with no
 * status (a plain list) or any decided or undecided-with-a-reason state can be opened.
 */
export function openable(r: { state?: RowState | null }): boolean {
  return r.state?.kind !== 'checking';
}

/** The plain word for a row's state (what can be attempted, never a result). */
export function stateWord(s: RowState): string {
  switch (s.kind) {
    case 'provable':
      return 'Proof can be attempted';
    case 'tested':
      return 'Can be tested';
    case 'checking':
      return 'Checking…';
    case 'unknown':
      // took longer than the cap, or the check failed: the server's own words say it plainly
      return s.reason && unknownCause(s.reason) !== 'pending' ? s.reason : 'Not checked yet';
    case 'none':
      return "Can't run";
  }
}

export const CAN_RUN_FOOTNOTE = 'Describes what Faithful can attempt, not what it will prove.';

const n = (x: number) => x.toLocaleString('en-US');

export function toggleWords(count: number, open: boolean): string {
  const what = `${n(count)} function${count === 1 ? '' : 's'} Faithful can't run`;
  return open ? `Hide the ${what}` : `Show ${what}`;
}

/** The note under a plain list (no status) when more functions match than are listed. */
export function moreWords(more: number): string {
  return `${n(more)} more function${more === 1 ? '' : 's'} match${more === 1 ? 'es' : ''}. Keep typing to narrow.`;
}

/**
 * The counts in words, only from the server's counts over ALL matches. Shown when the list is cut short or something is
 * undecided; never a percentage. "Can have a proof attempted" / "can be tested" are said only of functions that were
 * decided (the same words as a row's status): an aggregate that includes functions not checked yet is never "functions
 * Faithful can run" (that would claim a capability before the check). `listed`: rows in the list. `scanning`: the scan is
 * still running ("still being checked"). `rankedListed`: how many of the listed rows are decided; none of them while the
 * scan has not reached anything yet, and then the list is in file order, not "the best": it says so.
 */
export function pickNote(listed: number, counts: PickResult['counts'], scanning: boolean, rankedListed = listed): string | null {
  const runnable = counts.provable + counts.tested + counts.unknown;
  if (runnable === 0) return null;
  const cut = listed < runnable;
  // everything is listed and decided, or all that is left to say is "not decided" (each row already says why): nothing to add
  if (!cut && (counts.unknown === 0 || counts.provable + counts.tested === 0)) return null;
  const parts: string[] = [];
  if (counts.provable > 0) parts.push(`${n(counts.provable)} can have a proof attempted`);
  if (counts.tested > 0) parts.push(`${n(counts.tested)} can be tested`);
  if (counts.unknown > 0) parts.push(`${n(counts.unknown)} ${scanning ? 'still being checked' : 'not checked'}`);
  const tally = parts.join(', ');
  if (!cut) return `${tally}.`.replace(/^./, (c) => c.toUpperCase());
  // nothing in the list is decided yet (the scan is on its first files): these are the first functions in file order, not the best
  if (scanning && rankedListed === 0) return `Showing ${n(listed)} of ${n(runnable)} functions in file order, not ranked yet. Keep typing to narrow the list.`;
  const best = scanning && counts.unknown > 0 ? 'the best so far' : 'the best';
  const head = counts.unknown === 0 ? `Showing ${best} ${n(listed)} of ${n(runnable)} functions Faithful can run` : `Showing ${best} ${n(listed)} of ${n(runnable)}`;
  return `${head}: ${tally}. Keep typing to narrow the list.`;
}

/** The one quiet progress line while the scan runs ("of", never a slash: "7 / 10" reads as a rating). */
export function scanWords(scan: Pick<ScanStatus, 'filesDone' | 'filesTotal'>): string {
  return `Checking the repository: ${n(scan.filesDone)} of ${n(scan.filesTotal)} files`;
}

/** Is the progress line shown? Only while a pass has files left to decide (a pass over an unchanged repository has none). */
export function scanVisible(scan: ScanStatus | null): scan is ScanStatus {
  return scan !== null && scan.state === 'running' && scan.filesDone < scan.filesTotal;
}

/** What a screen reader hears about the scan: once when the progress line appears, once when it goes. Never per tick. */
export const SCAN_STARTED = 'Checking the repository.';
export const SCAN_FINISHED = 'Finished checking the repository.';

/** The identity of a row: the selection follows the function, not the position, when the list is re-ranked. */
export function rowKey(h: FnHit): string {
  return `${h.path}:${h.name}:${h.line}`;
}

/**
 * The index of the highlighted row in `rows` (selection kept as a row key): the row the person chose, when it is still in
 * the list and can be opened; otherwise the best row there is to open, the first one that `openable` allows. -1 when
 * nothing in the list can be opened (every row is still being checked): then nothing is highlighted. The highlight never
 * lands by position on a function the person did not choose: when the chosen function left the list it goes back to the
 * best row, not to whatever now sits where it was.
 */
export function activeIndex(rows: Array<{ hit: FnHit; state?: RowState | null }>, key: string | null): number {
  if (key !== null) {
    const i = rows.findIndex((r) => rowKey(r.hit) === key);
    if (i >= 0 && openable(rows[i]!)) return i;
  }
  return rows.findIndex(openable);
}

/**
 * The highlighted row of a list that can change under the pointer: held by row key, so a re-rank moves the highlight
 * with its function, never to whatever now sits at the same position; when its function leaves the list the highlight
 * returns to the best row (and the key with it, so a later reappearance does not pull it back). Rows that are still being
 * checked are skipped by `step`, and `select` ignores them.
 */
export function useSelection(rows: Array<{ hit: FnHit; state?: RowState | null }>) {
  const [key, setKey] = useState<string | null>(null);
  const cur = activeIndex(rows, key);
  const curKey = cur >= 0 ? rowKey(rows[cur]!.hit) : null;
  useEffect(() => {
    // the chosen function is gone (or not openable any more): forget it, the highlight is on the best row again
    if (key !== null && curKey !== key) setKey(null);
  }, [key, curKey]);
  return {
    /** Index of the highlighted row (-1: none; nothing can be opened yet). */
    cur,
    /** The key of the highlighted row (null: none). */
    curKey,
    select(i: number) {
      const r = rows[i];
      if (r && openable(r)) setKey(rowKey(r.hit));
    },
    /** Move the highlight to the next (`+1`) or previous (`-1`) row that can be opened; stays when there is none. */
    step(dir: 1 | -1) {
      for (let i = cur + dir; i >= 0 && i < rows.length; i += dir) {
        if (openable(rows[i]!)) return setKey(rowKey(rows[i]!.hit));
      }
      if (cur < 0) {
        const first = rows.findIndex(openable);
        if (first >= 0) setKey(rowKey(rows[first]!.hit));
      }
    },
    /** Back to "the best row" (the query changed). */
    clear() {
      setKey(null);
    },
  };
}

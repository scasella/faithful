/**
 * What both pick lists (Select and the Simple Pick step) show, as one hook: `usePickView`.
 *
 * Server mode (the normal one): the server ranks every exported function of the repository from its background scan
 * (`Actions.pickFunctions`, packages/cli/src/flow/scan.ts), so the first screen leads with what Faithful can attempt
 * however far down the search order it sits. The page
 *   - asks once on mount and again when the query changes (debounced), keeping rows that match an older query visible
 *     (a thin progress bar over the list, no dimming: the text keeps its contrast) and not openable until the answer for
 *     the current one arrives;
 *   - while the scan runs, polls its progress (`scanStatus`, about every 1.5 s) and asks again only when the scan's
 *     `version` moves or it finishes, so the rows re-rank in place; one quiet progress line, and a screen-reader line
 *     that changes only when it appears and when it goes;
 *   - when the window regains focus, asks the server for a new pass (idempotent: it re-checks only changed files) and
 *     asks again.
 * It always asks for the functions Faithful can't run too (at most 200, loopback), so the toggle and the "only
 * functions that can't run match" case need no second request.
 *
 * Local mode: the adapter answered null (a replay, a fixture) or the first ask failed. The page lists `listFiles()` with
 * its own typeahead, in search order, without statuses; a failed ask says so (the list is then unranked).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Actions, FileEntry, PickResult, ScanStatus } from '../../actions';
import { matchFunctions } from './match';
import { SCAN_FINISHED, SCAN_STARTED, moreWords, pickNote, pickRow, scanVisible, scanWords, type Row } from './runnable';

/** Timings in ms. A plain object so a test can shorten them; nothing else writes to it. */
export const PICK_TIMING = { debounceMs: 150, pollMs: 1500, focusMs: 1000 };

export interface PickView {
  /** 'listing': nothing to show yet. 'failed': the local listing failed (`failure`). */
  phase: 'listing' | 'ready' | 'failed';
  failure: string | null;
  /** Server mode: the last ask failed (rows from an earlier answer are kept; the page asks again on the next change). */
  askError: string | null;
  /** The first ask failed, so the list is unranked and has no statuses (the reason, in the error's words). */
  degraded: string | null;
  /** Rows to list, best first (server order). */
  shown: Row[];
  /** Matches Faithful can't run, with reasons (at most 200). */
  cannot: Row[];
  /** How many matches can't run, over all matches (`cannot` is capped). */
  cannotTotal: number;
  /** Statuses exist (server mode): the can't-run toggle and the footnote are shown. */
  statuses: boolean;
  /** The rows answer an older query: shown dimmed, not openable. */
  stale: boolean;
  /** No function was found at all in the repository (as opposed to none matching). */
  emptyRepo: boolean;
  /** The counts in words (server mode), or the "N more match" note of a plain list. */
  note: string | null;
  /** The one progress line while the scan runs. */
  scanLine: string | null;
  /** The only text a screen reader gets about scan progress. */
  announce: string;
}

interface Asked {
  query: string;
  result: PickResult;
}

export function usePickView(adapter: Actions, query: string, limit: number): PickView {
  const [mode, setMode] = useState<'pending' | 'server' | 'local'>('pending');
  const [asked, setAsked] = useState<Asked | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [announce, setAnnounce] = useState('');
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  const alive = useRef(true);
  /** What asks read when they fire (they outlive a render). */
  const cur = useRef({ query, limit, mode, version: -1 });
  cur.current.query = query;
  cur.current.limit = limit;
  cur.current.mode = mode;
  /** The latest ask wins; a scan status is applied only if no later request has already applied one. */
  const seq = useRef(0);
  const reqN = useRef(0);
  const appliedScan = useRef(0);
  const latestScan = useRef<ScanStatus | null>(null);
  const lastQuery = useRef(query);
  /** Asks sent and not yet answered: the poll does not pile another on top of a slow one. */
  const inflight = useRef(0);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const applyScan = useCallback((n: number, s: ScanStatus) => {
    if (n < appliedScan.current || !alive.current) return;
    appliedScan.current = n;
    latestScan.current = s;
    setScan(s);
  }, []);

  const ask = useCallback(() => {
    const { query: q, limit: l } = cur.current;
    const mine = ++seq.current;
    const n = ++reqN.current;
    inflight.current++;
    adapter.pickFunctions(q, { limit: l, includeUnrunnable: true }).then(
      (r) => {
        inflight.current--;
        if (mine !== seq.current || !alive.current) return;
        if (r === null) return setMode('local');
        cur.current.version = r.scan.version;
        setMode('server');
        setAskError(null);
        setAsked({ query: q, result: r });
        applyScan(n, r.scan);
        // a later poll already saw the scan move past what this answer was ranked from (and skipped asking while this one was on its way)
        if (appliedScan.current > n && latestScan.current && latestScan.current.version !== r.scan.version) ask();
      },
      (e: unknown) => {
        inflight.current--;
        if (mine !== seq.current || !alive.current) return;
        const message = (e instanceof Error ? e.message : '') || String(e);
        if (cur.current.mode === 'pending') {
          setDegraded(message);
          setMode('local');
        } else setAskError(message);
      },
    );
  }, [adapter, applyScan]);

  // Ask on mount at once, and after each change of the query once typing pauses.
  const local = mode === 'local';
  useEffect(() => {
    if (local) return;
    const typed = query !== lastQuery.current;
    lastQuery.current = query;
    if (!typed && cur.current.mode === 'pending') {
      ask();
      return;
    }
    const t = setTimeout(ask, PICK_TIMING.debounceMs);
    return () => clearTimeout(t);
  }, [adapter, query, limit, local]);

  // While the scan runs: poll its progress; ask again only when it moved or ended.
  const running = mode === 'server' && scan?.state === 'running';
  useEffect(() => {
    if (!running) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const n = ++reqN.current;
      try {
        const s = await adapter.scanStatus();
        if (!live) return;
        if (s !== null) applyScan(n, s);
        // moved (or ended) since the rows were ranked: rank again, unless an ask is still on its way
        if ((s === null || s.version !== cur.current.version || s.state !== 'running') && inflight.current === 0) ask();
      } catch {
        // the next tick tries again
      }
      if (live) timer = setTimeout(tick, PICK_TIMING.pollMs);
    };
    timer = setTimeout(tick, PICK_TIMING.pollMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [adapter, running, ask, applyScan]);

  // When the window regains focus: a new pass (cheap, idempotent: only changed files are re-checked), then ask again.
  useEffect(() => {
    if (mode !== 'server') return;
    let last = 0;
    const reask = () => {
      const now = Date.now();
      if (now - last < PICK_TIMING.focusMs) return;
      last = now;
      adapter
        .startScan()
        .then(
          () => undefined,
          () => undefined,
        )
        .then(ask);
    };
    // coming back to the tab fires visibilitychange (and often focus too: one ask, see the throttle above); going away must not
    const shown = () => document.visibilityState === 'visible' && reask();
    window.addEventListener('focus', reask);
    document.addEventListener('visibilitychange', shown);
    return () => {
      window.removeEventListener('focus', reask);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [adapter, mode, ask]);

  // Local mode: list the files here.
  useEffect(() => {
    if (!local) return;
    let live = true;
    adapter.listFiles().then(
      (f) => live && (setFiles(f), setListErr(null)),
      (e: Error) => live && setListErr(e.message || String(e)),
    );
    return () => {
      live = false;
    };
  }, [adapter, local]);

  const showLine = mode === 'server' && scanVisible(scan);
  const wasShown = useRef(false);
  useEffect(() => {
    if (showLine !== wasShown.current) setAnnounce(showLine ? SCAN_STARTED : SCAN_FINISHED);
    wasShown.current = showLine;
  }, [showLine]);

  const scanning = scan?.state === 'running';
  const server = useMemo(() => {
    if (mode !== 'server' || !asked) return null;
    const rows = (rs: PickResult['rows']) => rs.map((r) => pickRow(r, asked.query, scanning));
    return { shown: rows(asked.result.rows), cannot: rows(asked.result.cannotRun) };
  }, [mode, asked, scanning]);
  const plain = useMemo(() => (mode === 'local' && files ? matchFunctions(files, query, limit) : null), [mode, files, query, limit]);

  const base = { askError, degraded, announce, scanLine: null as string | null };
  if (mode === 'server' && asked && server) {
    const r = asked.result;
    return {
      ...base,
      phase: 'ready',
      failure: null,
      shown: server.shown,
      cannot: server.cannot,
      cannotTotal: r.counts.none,
      statuses: true,
      stale: asked.query !== query,
      emptyRepo: r.totalMatches === 0 && asked.query.trim() === '',
      note: pickNote(r.rows.length, r.counts, scanning, server.shown.filter((x) => x.state?.kind === 'provable' || x.state?.kind === 'tested').length),
      scanLine: showLine && scan ? scanWords(scan) : null,
    };
  }
  if (mode === 'local' && listErr !== null) {
    return { ...base, phase: 'failed', failure: listErr, shown: [], cannot: [], cannotTotal: 0, statuses: false, stale: false, emptyRepo: false, note: null };
  }
  if (plain) {
    return {
      ...base,
      phase: 'ready',
      failure: null,
      shown: plain.hits.map((hit) => ({ hit, state: null })),
      cannot: [],
      cannotTotal: 0,
      statuses: false,
      stale: false,
      emptyRepo: (files?.length ?? 0) === 0,
      note: plain.total > plain.hits.length ? moreWords(plain.total - plain.hits.length) : null,
    };
  }
  return { ...base, phase: 'listing', failure: null, shown: [], cannot: [], cannotTotal: 0, statuses: false, stale: false, emptyRepo: false, note: null };
}

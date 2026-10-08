// @vitest-environment happy-dom
/**
 * The pick lists over the SERVER's ranking (`Actions.pickFunctions`, `scanStatus`, `startScan`): the pure words and
 * selection helpers, and both views in a DOM (Select and the Simple Pick step) against a small simulated server that
 * follows the contract in apps/ui/API.md: ranking over every function (not the first matches in search order), counts over
 * all matches, the toggle for what can't run, the quiet scan line, rows re-ranked IN PLACE as the scan advances (the
 * highlight stays on its function, focus stays in the field), unknown rows that say why, a re-ask when the window regains
 * focus, and the plain local list when the adapter answers null (a replay, a fixture). The claim sweep over this text is in
 * app/claims.sweep.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render, type FunctionComponent } from 'preact';
import { act } from 'preact/test-utils';
import type { FileEntry, PickOptions, PickResult, PickRow, ScanStatus } from '../../actions';
import { AppContext } from '../../app/AppContext';
import { PickStep } from '../../simple/PickStep';
import { fakeAdapter, storeWith, type FakeAdapter } from '../agree/testkit';
import { nameHitsFor } from './match';
import { PICK_TIMING } from './pickView';
import { ReasonText } from './CannotRun';
import {
  CAN_RUN_FOOTNOTE,
  SCAN_FINISHED,
  SCAN_STARTED,
  activeIndex,
  moreWords,
  openable,
  pickNote,
  pickRow,
  rowKey,
  scanVisible,
  scanWords,
  stateWord,
  toggleWords,
  unknownCause,
} from './runnable';
import { SelectScreen } from './SelectScreen';

const PENDING = 'Not checked yet: the scan has not reached it.';
const SLOW = 'Checking took longer than 3 seconds; not run.';
const FAILED = 'The check itself failed; not run.';
const IMPORT_REASON = 'Cannot run on its own: its file imports another module (line 1, column 1). The translator refuses it too (syntax outside the subset).';
const GENERIC_REASON = 'Inputs cannot be generated from its signature: g is generic (type parameter T). The translator refuses it too (generic type parameters).';

const row = (file: string, name: string, tier: PickRow['tier'], o: Partial<PickRow> = {}): PickRow => ({
  file,
  name,
  line: 1,
  hasJsDoc: false,
  tier,
  reason: tier === 'none' ? IMPORT_REASON : null,
  ...o,
});

// ───────────────────────── the simulated server ─────────────────────────

const TIER_ORDER = { provable: 0, tested: 1, unknown: 2, none: 3 } as const;

/** What `POST /api/functions/pick` does (packages/cli/src/flow/scan.ts), over a table of functions the test edits. */
class FakeServer {
  scan: ScanStatus = { state: 'done', filesDone: 10, filesTotal: 10, version: 1 };
  constructor(public fns: PickRow[]) {}

  matches(query: string): PickRow[] {
    const q = query.trim().toLowerCase();
    return this.fns.filter((f) => !q || f.name.toLowerCase().includes(q) || f.file.toLowerCase().includes(q));
  }

  pick = async (query: string, o: PickOptions = {}): Promise<PickResult> => {
    const q = query.trim().toLowerCase();
    const group = (f: PickRow) => (f.name.toLowerCase() === q ? 0 : f.name.toLowerCase().startsWith(q) ? 1 : 2);
    // copies: an answer is a snapshot, later scan steps must not change rows already delivered
    const all = this.matches(query).map((f) => ({ ...f })).sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        group(a) - group(b) ||
        Number(b.hasJsDoc) - Number(a.hasJsDoc) ||
        (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
        a.line - b.line,
    );
    const counts = { provable: 0, tested: 0, unknown: 0, none: 0 };
    for (const f of all) counts[f.tier]++;
    const limit = Math.min(50, Math.max(1, o.limit ?? 8));
    return {
      rows: all.filter((f) => f.tier !== 'none').slice(0, limit),
      totalMatches: all.length,
      counts,
      cannotRun: o.includeUnrunnable ? all.filter((f) => f.tier === 'none').slice(0, 200) : [],
      scan: { ...this.scan },
    };
  };

  /** A scan step: `decide` changes some functions' tiers; the version moves and the files-done counter advances. */
  step(decide: (fns: PickRow[]) => void, done = this.scan.filesDone + 1): void {
    decide(this.fns);
    this.scan = { ...this.scan, version: this.scan.version + 1, filesDone: done };
  }
  finish(): void {
    this.scan = { ...this.scan, state: 'done', filesDone: this.scan.filesTotal };
  }
}

/** 55 tested functions that sort first by path, three provable ones far down, two that can't run, three not decided. */
function repo(): PickRow[] {
  return [
    ...Array.from({ length: 55 }, (_, i) => row(`a/t${String(i).padStart(2, '0')}.ts`, `t${String(i).padStart(2, '0')}`, 'tested')),
    row('a/live.ts', 'liveWorkers', 'none', { line: 4 }),
    row('a/z3.ts', 'browserZ3', 'none', { reason: GENERIC_REASON }),
    row('z/gcd.ts', 'gcd', 'provable', { line: 2, hasJsDoc: true }),
    row('z/clamp.ts', 'clamp', 'provable'),
    row('z/fib.ts', 'fib', 'provable', { line: 3 }),
    row('b/late.ts', 'lateOne', 'unknown', { reason: PENDING }),
    row('b/slow.ts', 'slowOne', 'unknown', { reason: SLOW }),
    row('b/broken.ts', 'brokenOne', 'unknown', { reason: FAILED }),
  ];
}

// ───────────────────────── pure ─────────────────────────

describe('words and rows', () => {
  it('tells the three reasons for "not decided" apart', () => {
    expect(unknownCause(PENDING)).toBe('pending');
    expect(unknownCause(SLOW)).toBe('slow');
    expect(unknownCause(FAILED)).toBe('failed');
    expect(unknownCause(null)).toBe('pending');
  });

  it('a row says plainly what can be attempted; a slow or failed check says why in the server\'s words', () => {
    const w = (r: PickRow, scanning = false) => stateWord(pickRow(r, '', scanning).state!);
    expect(w(row('a.ts', 'f', 'provable'))).toBe('Proof can be attempted');
    expect(w(row('a.ts', 'f', 'tested'))).toBe('Can be tested');
    expect(w(row('a.ts', 'f', 'unknown', { reason: PENDING }), true)).toBe('Checking…');
    expect(w(row('a.ts', 'f', 'unknown', { reason: PENDING }), false)).toBe('Not checked yet');
    expect(w(row('a.ts', 'f', 'unknown', { reason: SLOW }), true)).toBe(SLOW);
    expect(w(row('a.ts', 'f', 'unknown', { reason: FAILED }), false)).toBe(FAILED);
    expect(w(row('a.ts', 'f', 'unknown', { reason: null }))).toBe('Not checked yet');
    expect(w(row('a.ts', 'f', 'none'))).toBe("Can't run");
  });

  it('a server row becomes a list row keyed by file, name and line, with the matched letters of the name', () => {
    const r = pickRow(row('src/math/fib.ts', 'fibonacci', 'tested', { line: 9 }), 'fbn', false);
    expect(r.hit).toEqual({ path: 'src/math/fib.ts', name: 'fibonacci', line: 9, hasJsDoc: false, nameHits: [0, 2, 4] });
    expect(rowKey(r.hit)).toBe('src/math/fib.ts:fibonacci:9');
    expect(nameHitsFor('', 'x', 'y.ts')).toEqual([]);
  });

  it('counts in words, only from the server counts, never a percentage; shown when the list is cut short or something is undecided', () => {
    const c = { provable: 1107, tested: 471, unknown: 7, none: 500 };
    // anything not checked yet makes the aggregate "N", never "N functions Faithful can run": that would claim a capability before the check
    expect(pickNote(8, c, false)).toBe('Showing the best 8 of 1,585: 1,107 can have a proof attempted, 471 can be tested, 7 not checked. Keep typing to narrow the list.');
    // the scan is still going and some of the list is decided: the best so far
    expect(pickNote(8, { provable: 12, tested: 3, unknown: 900, none: 0 }, true)).toBe(
      'Showing the best so far 8 of 915: 12 can have a proof attempted, 3 can be tested, 900 still being checked. Keep typing to narrow the list.',
    );
    // nothing in the list is decided yet (the scan is on its first files): the rows are in file order, and the note says that, not "the best"
    expect(pickNote(50, { provable: 0, tested: 0, unknown: 463, none: 0 }, true, 0)).toBe('Showing 50 of 463 functions in file order, not ranked yet. Keep typing to narrow the list.');
    expect(pickNote(8, { provable: 0, tested: 0, unknown: 2094, none: 0 }, true, 0)).toBe('Showing 8 of 2,094 functions in file order, not ranked yet. Keep typing to narrow the list.');
    // everything decided: the capability words may stand for the aggregate
    expect(pickNote(8, { provable: 3, tested: 58, unknown: 0, none: 2 }, false)).toBe('Showing the best 8 of 61 functions Faithful can run: 3 can have a proof attempted, 58 can be tested. Keep typing to narrow the list.');
    // everything is listed and decided: nothing to add; nothing runnable: nothing to say
    expect(pickNote(5, { provable: 3, tested: 2, unknown: 0, none: 40 }, false)).toBeNull();
    expect(pickNote(0, { provable: 0, tested: 0, unknown: 0, none: 4 }, false)).toBeNull();
    // everything is listed and nothing is decided yet: each row already says so (and the scan line says how far it is)
    expect(pickNote(3, { provable: 0, tested: 0, unknown: 3, none: 0 }, true)).toBeNull();
    // everything is listed but one is still undecided
    expect(pickNote(3, { provable: 2, tested: 0, unknown: 1, none: 0 }, true)).toBe('2 can have a proof attempted, 1 still being checked.');
    // the count words are the row words ("Proof can be attempted"): the aggregate never says "can be proved"
    for (const s of [pickNote(8, c, false)!, pickNote(3, { provable: 2, tested: 0, unknown: 1, none: 0 }, true)!, pickNote(8, { provable: 3, tested: 58, unknown: 0, none: 2 }, false)!]) expect(s).not.toMatch(/can be proved/);
    for (const s of [pickNote(8, c, false)!, pickNote(8, c, true, 0)!, scanWords({ filesDone: 3, filesTotal: 10 }), toggleWords(500, false), moreWords(3)]) expect(s).not.toMatch(/%|percent|\d\s*\/\s*\d/);
  });

  it('the scan line says "of", not a slash, and exists only while a pass has files left', () => {
    expect(scanWords({ filesDone: 312, filesTotal: 1518 })).toBe('Checking the repository: 312 of 1,518 files');
    const run = (filesDone: number, filesTotal: number, state: ScanStatus['state'] = 'running'): ScanStatus => ({ state, filesDone, filesTotal, version: 1 });
    expect(scanVisible(run(3, 10))).toBe(true);
    expect(scanVisible(run(10, 10))).toBe(false); // a pass over an unchanged repository: nothing is left to decide
    expect(scanVisible(run(0, 0))).toBe(false);
    expect(scanVisible(run(3, 10, 'done'))).toBe(false);
    expect(scanVisible(null)).toBe(false);
  });

  it('the toggle and the plain-list note', () => {
    expect(toggleWords(1, false)).toBe("Show 1 function Faithful can't run");
    expect(toggleWords(2038, true)).toBe("Hide the 2,038 functions Faithful can't run");
    expect(moreWords(2038)).toBe('2,038 more functions match. Keep typing to narrow.');
    expect(moreWords(1)).toBe('1 more function matches. Keep typing to narrow.');
  });

  it('the highlight follows its function; when the function leaves the list it goes back to the best row, never to whatever sits where it was', () => {
    const hit = (name: string) => ({ path: 'f.ts', name, line: 1, hasJsDoc: false, nameHits: [] });
    const rows = ['a', 'b', 'c', 'd'].map((name) => ({ hit: hit(name) }));
    expect(activeIndex(rows, null)).toBe(0);
    expect(activeIndex(rows, rowKey(rows[3]!.hit))).toBe(3);
    expect(activeIndex(rows.slice(1), rowKey(rows[3]!.hit))).toBe(2);
    // gone: the best row, not the function that now sits at the same position
    expect(activeIndex([rows[0]!, rows[1]!, rows[3]!], rowKey(rows[2]!.hit))).toBe(0);
    expect(activeIndex([rows[0]!, rows[1]!], rowKey(rows[2]!.hit))).toBe(0);
    expect(activeIndex([], rowKey(rows[2]!.hit))).toBe(-1);
  });

  it('a row that is still being checked is never the highlight and cannot be opened; nothing is highlighted when every row is', () => {
    const hit = (name: string) => ({ path: 'f.ts', name, line: 1, hasJsDoc: false, nameHits: [] });
    const checking = (name: string) => ({ hit: hit(name), state: { kind: 'checking' } as const });
    const tested = (name: string) => ({ hit: hit(name), state: { kind: 'tested' } as const });
    const pending = { hit: hit('p'), state: { kind: 'unknown', reason: PENDING } as const };
    expect(openable(checking('a'))).toBe(false);
    for (const r of [tested('a'), pending, { hit: hit('x'), state: null }, { hit: hit('y') }, { hit: hit('z'), state: { kind: 'unknown', reason: SLOW } as const }]) expect(openable(r)).toBe(true);
    expect(activeIndex([checking('a'), checking('b'), tested('c')], null)).toBe(2);
    expect(activeIndex([checking('a'), checking('b')], null)).toBe(-1);
    // chosen earlier, but not something that can be opened: the best row that can
    expect(activeIndex([checking('a'), tested('b')], rowKey(hit('a')))).toBe(1);
    // the list in which nothing is decided yet, then the same list once the scan decided "b"
    expect(activeIndex([checking('a'), checking('b')], rowKey(hit('b')))).toBe(-1);
  });

  it('backtick spans in a reason render as code, never as literal backticks', () => {
    const el = document.createElement('div');
    act(() => render(h(ReasonText, { text: 'Cannot run on its own: f is a function stored in a variable; the Tested tier runs only function declarations such as `function f(...) { ... }` (line 7, column 1).' }), el));
    expect(el.textContent).not.toContain('`');
    expect(el.querySelector('code')?.textContent).toBe('function f(...) { ... }');
    act(() => render(null, el));
  });
});

// ───────────────────────── both views in a DOM ─────────────────────────

describe('both pick views in a DOM', () => {
  let root: HTMLElement;
  const saved = { ...PICK_TIMING };
  beforeEach(() => {
    Object.assign(PICK_TIMING, { debounceMs: 20, pollMs: 40, focusMs: 0 });
  });
  afterEach(() => {
    act(() => render(null, root));
    root.remove();
    Object.assign(PICK_TIMING, saved);
  });

  const sleep = (ms: number) => act(async () => await new Promise((r) => setTimeout(r, ms)));
  async function until(pred: () => boolean, label: string, ms = 3000) {
    for (let t = 0; t < ms && !pred(); t += 10) await sleep(10);
    expect(pred(), label).toBe(true);
  }
  const keyOn = (el: EventTarget, key: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
  const type = (input: HTMLInputElement, v: string) =>
    act(() => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  type View = 'select' | 'simple';
  const LIMIT: Record<View, number> = { select: 50, simple: 8 };
  const input = () => root.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const options = () => [...root.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
  const names = () => [...root.querySelectorAll('[role="option"]')].map((o) => (o.querySelector('.sel-name, .s-res-name')?.textContent ?? '').trim());
  const selected = () => root.querySelector('[role="option"][aria-selected="true"]');
  const toggle = () => [...root.querySelectorAll('button')].find((b) => /Faithful can't run/.test(b.textContent ?? ''));
  const scanLine = () => root.querySelector('.run-scan')?.textContent ?? null;
  const announced = () => root.querySelector('p.sr-only[aria-live]')?.textContent ?? '';

  function mount(view: View, server: FakeServer | null, tweak?: (a: FakeAdapter) => void): FakeAdapter {
    root = document.createElement('div');
    document.body.append(root);
    const files: FileEntry[] = [
      { path: 'src/math/fib.ts', functions: [{ name: 'fib', line: 2, hasJsDoc: true }, { name: 'fibFloat', line: 9, hasJsDoc: false }] },
      { path: 'src/math/gcd.ts', functions: [{ name: 'gcd', line: 1, hasJsDoc: false }] },
    ];
    const adapter = fakeAdapter(files);
    if (server) {
      adapter.pickFunctions.mockImplementation(server.pick);
      adapter.scanStatus.mockImplementation(async () => ({ ...server.scan }));
      adapter.startScan.mockImplementation(async () => ({ ...server.scan }));
    }
    tweak?.(adapter);
    const Screen = (view === 'select' ? SelectScreen : PickStep) as FunctionComponent;
    act(() => render(h(AppContext.Provider, { value: { store: storeWith([]), adapter } }, h(Screen, {})), root));
    return adapter;
  }

  it('Select: Esc clears the query and the list returns to the first screen; Esc with an empty query leaves the field', async () => {
    const server = new FakeServer(repo());
    const adapter = mount('select', server);
    await until(() => options().length > 0, 'rows');
    input().focus();
    type(input(), 'gcd');
    await until(() => names().join() === 'gcd', 'filtered');
    keyOn(input(), 'Escape');
    expect(input().value).toBe('');
    await until(() => names().length === 50 && names()[0] === 'gcd' && names()[1] === 'clamp', 'first screen again');
    expect(adapter.pickFunctions.mock.calls.at(-1)![0]).toBe('');
    expect(document.activeElement).toBe(input());
    keyOn(input(), 'Escape');
    expect(document.activeElement).not.toBe(input());
  });

  for (const view of ['select', 'simple'] as const) {
    describe(view, () => {
      it('the first screen leads with what the server ranked over the whole repository, not the first matches in search order', async () => {
        const server = new FakeServer(repo());
        const adapter = mount(view, server);
        await until(() => options().length > 0, 'rows');
        // 55 testable functions come first in search order (path a/…); the three provable ones sit in z/…: they lead
        expect(names().slice(0, 4)).toEqual(['gcd', 'clamp', 'fib', 't00']);
        expect(options()[0]).toBe('gcdz/gcd.ts:2Proof can be attempted');
        expect(options()[3]).toBe('t00a/t00.ts:1Can be tested');
        expect(options()).toHaveLength(LIMIT[view]);
        expect(adapter.pickFunctions).toHaveBeenCalledWith('', { limit: LIMIT[view], includeUnrunnable: true });
        // the list is the server's: no client-side listing or per-file status asks
        expect(adapter.listFiles).not.toHaveBeenCalled();
        expect(adapter.functionStatus).not.toHaveBeenCalled();
        // counts in words, from the server's counts over all matches
        const total = 55 + 3 + 3;
        expect(root.textContent).toContain(`Showing the best ${LIMIT[view]} of ${total}: 3 can have a proof attempted, 55 can be tested, 3 not checked. Keep typing to narrow the list.`);
        expect(root.textContent).not.toMatch(/functions Faithful can run:/); // three are not checked: no capability for the aggregate
        expect(root.textContent).toContain(CAN_RUN_FOOTNOTE);
        expect(root.textContent).not.toMatch(/%|percent/);
        // a "can be attempted" status is never the tier badge
        expect(root.querySelector('.tier, .tier-label, [class*="tier-"]')).toBeNull();
        expect(scanLine()).toBeNull();
      });

      it('typing asks again after a pause; rows that answer the older query are dimmed and cannot be opened', async () => {
        const server = new FakeServer(repo());
        let release!: () => void;
        const adapter = mount(view, server, (a) => {
          a.pickFunctions.mockImplementation(async (q, o) => {
            const r = await server.pick(q, o);
            if (q === 'fib') await new Promise<void>((res) => (release = res));
            return r;
          });
        });
        await until(() => options().length > 0, 'rows');
        const calls = adapter.pickFunctions.mock.calls.length;
        type(input(), 'f');
        type(input(), 'fi');
        type(input(), 'fib');
        await until(() => adapter.pickFunctions.mock.calls.length > calls, 'asked');
        // typed three times quickly: one ask, for what was typed last
        expect(adapter.pickFunctions.mock.calls.slice(calls).map((c) => c[0])).toEqual(['fib']);
        const list = root.querySelector('[role="listbox"]')!;
        expect(list.getAttribute('aria-busy')).toBe('true');
        keyOn(input(), 'Enter'); // the highlighted row belongs to the empty query: not opened
        expect(adapter.openFunction).not.toHaveBeenCalled();
        release();
        await until(() => root.querySelector('[role="listbox"]')?.getAttribute('aria-busy') === 'false', 'fresh');
        expect(names()).toEqual(['fib']);
        keyOn(input(), 'Enter');
        expect(adapter.openFunction).toHaveBeenCalledWith('z/fib.ts', 'fib');
      });

      it('while the scan runs: one quiet line, rows re-ranked IN PLACE (the highlight stays on its function, focus stays in the field), polling stops at done', async () => {
        const fns = [
          row('a/one.ts', 'one', 'unknown', { reason: PENDING }),
          row('a/two.ts', 'two', 'unknown', { reason: PENDING }),
          row('a/three.ts', 'three', 'unknown', { reason: PENDING }),
          row('a/four.ts', 'four', 'unknown', { reason: PENDING }),
        ];
        const server = new FakeServer(fns);
        server.scan = { state: 'running', filesDone: 0, filesTotal: 4, version: 1 };
        const adapter = mount(view, server);
        await until(() => options().length === 4, 'rows');
        expect(scanLine()).toBe('Checking the repository: 0 of 4 files');
        expect(options().every((o) => o.endsWith('Checking…'))).toBe(true);
        expect(root.textContent).not.toMatch(/still being checked\.?\s*Keep|Showing the best/); // all four are listed, none decided: the rows and the line say it
        // the line is plain text: not inside a live region (a counter ticking every second must not be read out each time)
        expect(root.querySelector('.run-scan')!.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
        expect(announced()).toBe(SCAN_STARTED);

        input().focus();
        expect(document.activeElement).toBe(input());
        // nothing is decided yet, so nothing is a choice: no highlight, the arrows and Enter do nothing, and a click does not open
        expect(selected()).toBeNull();
        expect(input().hasAttribute('aria-activedescendant')).toBe(false);
        keyOn(input(), 'ArrowDown');
        keyOn(input(), 'ArrowDown');
        keyOn(input(), 'Enter');
        act(() => void (root.querySelector('[role="option"]') as HTMLElement).click());
        expect(selected()).toBeNull();
        expect(adapter.openFunction).not.toHaveBeenCalled();
        expect([...root.querySelectorAll('[role="option"]')].every((o) => o.getAttribute('aria-disabled') === 'true')).toBe(true);

        // the scan decides "four" (provable) and "three" (tested): the version moves, the rows re-rank
        const asks = adapter.pickFunctions.mock.calls.length;
        server.step((f) => {
          f[3]!.tier = 'provable';
          f[2]!.tier = 'tested';
        }, 2);
        await until(() => names().join() === 'four,three,one,two', 're-ranked');
        expect(names()).toEqual(['four', 'three', 'one', 'two']);
        expect(adapter.pickFunctions.mock.calls.length).toBe(asks + 1);
        expect(scanLine()).toBe('Checking the repository: 2 of 4 files');
        // the best row that can be opened is the highlight; the two still being checked are not choices
        expect(selected()!.textContent).toMatch(/^four/);
        expect(root.querySelectorAll('[role="option"][aria-disabled="true"]')).toHaveLength(2);
        keyOn(input(), 'ArrowDown'); // "three"
        expect(selected()!.textContent).toMatch(/^three/);
        keyOn(input(), 'ArrowDown'); // the next two are still being checked: it stays on "three"
        expect(selected()!.textContent).toMatch(/^three/);

        // "one" is decided too: it ranks above "three" (path order), and the highlight moves with "three" (index 2 now)
        server.step((f) => (f[0]!.tier = 'tested'), 3);
        await until(() => names().join() === 'four,one,three,two', 're-ranked again');
        expect(selected()!.textContent).toMatch(/^three/);
        expect(input().getAttribute('aria-activedescendant')).toBe(selected()!.id);
        expect(document.activeElement).toBe(input());

        // ticks that find nothing new do not ask again, and the screen-reader line does not change
        const quiet = adapter.pickFunctions.mock.calls.length;
        await sleep(150);
        expect(adapter.pickFunctions.mock.calls.length).toBe(quiet);
        expect(announced()).toBe(SCAN_STARTED);

        // finished: the line goes, the final ranking is asked for once more, and polling stops
        server.step((f) => {
          f[1]!.tier = 'none';
        }, 4);
        server.finish();
        await until(() => scanLine() === null, 'line gone');
        await until(() => names().length === 3, 'final ranking');
        expect(names()).toEqual(['four', 'one', 'three']);
        expect(announced()).toBe(SCAN_FINISHED);
        expect(root.textContent).toContain("Show 1 function Faithful can't run");
        expect(selected()!.textContent).toMatch(/^three/);
        expect(document.activeElement).toBe(input());
        const polls = adapter.scanStatus.mock.calls.length;
        await sleep(150);
        expect(adapter.scanStatus.mock.calls.length).toBe(polls);
      });

      it('a row that is still being checked cannot be opened, by Enter or a click, until it is decided; then it can', async () => {
        const server = new FakeServer([row('a/one.ts', 'one', 'unknown', { reason: PENDING }), row('a/two.ts', 'two', 'unknown', { reason: PENDING })]);
        server.scan = { state: 'running', filesDone: 0, filesTotal: 2, version: 1 };
        const adapter = mount(view, server);
        await until(() => options().length === 2, 'rows');
        input().focus();
        keyOn(input(), 'Enter');
        for (const o of root.querySelectorAll<HTMLElement>('[role="option"]')) act(() => o.click());
        expect(adapter.openFunction).not.toHaveBeenCalled();
        server.step((f) => (f[1]!.tier = 'tested'), 1);
        await until(() => names().join() === 'two,one', 'two decided');
        // "two" is first, highlighted by default; "one" is still being checked
        expect(selected()!.textContent).toMatch(/^two/);
        act(() => void (root.querySelectorAll<HTMLElement>('[role="option"]')[1] as HTMLElement).click());
        expect(adapter.openFunction).not.toHaveBeenCalled();
        keyOn(input(), 'Enter');
        expect(adapter.openFunction).toHaveBeenCalledWith('a/two.ts', 'two');
      });

      it('before anything is ranked the note says the rows are in file order, not "the best"; once some are decided it says "so far"', async () => {
        const n = LIMIT[view] + 5;
        const fns = Array.from({ length: n }, (_, i) => row(`a/f${String(i).padStart(2, '0')}.ts`, `f${String(i).padStart(2, '0')}`, 'unknown', { reason: PENDING }));
        const server = new FakeServer(fns);
        server.scan = { state: 'running', filesDone: 0, filesTotal: n, version: 1 };
        mount(view, server);
        await until(() => options().length === LIMIT[view], 'rows');
        const note = () => root.textContent ?? '';
        expect(note()).toContain(`Showing ${LIMIT[view]} of ${n} functions in file order, not ranked yet.`);
        expect(note()).not.toMatch(/the best/);
        server.step((f) => (f[n - 1]!.tier = 'provable'), 1);
        await until(() => names()[0] === `f${String(n - 1).padStart(2, '0')}`, 'the decided one leads');
        expect(note()).toContain(`Showing the best so far ${LIMIT[view]} of ${n}: 1 can have a proof attempted, ${n - 1} still being checked.`);
        server.step((f) => f.forEach((x) => (x.tier = 'tested')), n);
        server.finish();
        await until(() => scanLine() === null && /Showing the best \d+ of \d+ functions Faithful can run/.test(note()), 'final');
        expect(note()).not.toMatch(/so far|not ranked yet/);
      });

      it('the page does not scroll because a re-rank changed which row is best; it scrolls when an arrow key moves the highlight', async () => {
        const scrolled = vi.fn();
        const saved = (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
        (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = scrolled;
        try {
          const server = new FakeServer([row('a/one.ts', 'one', 'unknown', { reason: PENDING }), row('a/two.ts', 'two', 'unknown', { reason: PENDING }), row('a/three.ts', 'three', 'unknown', { reason: PENDING })]);
          server.scan = { state: 'running', filesDone: 0, filesTotal: 3, version: 1 };
          mount(view, server);
          await until(() => options().length === 3, 'rows');
          server.step((f) => (f[2]!.tier = 'provable'), 1);
          await until(() => names()[0] === 'three', 'a new best row');
          server.step((f) => (f[1]!.tier = 'provable'), 2);
          await until(() => names().join() === 'three,two,one', 'another new best row');
          await sleep(50);
          expect(scrolled).not.toHaveBeenCalled();
          if (view === 'select') {
            input().focus();
            keyOn(input(), 'ArrowDown');
            await sleep(20);
            expect(scrolled).toHaveBeenCalledTimes(1);
          }
        } finally {
          (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = saved;
        }
      });

      it('the screen-reader line changes only at start and finish, however many ticks the scan takes', async () => {
        const server = new FakeServer([row('a/one.ts', 'one', 'unknown', { reason: PENDING }), row('a/two.ts', 'two', 'unknown', { reason: PENDING })]);
        server.scan = { state: 'running', filesDone: 0, filesTotal: 20, version: 1 };
        mount(view, server);
        await until(() => options().length === 2, 'rows');
        const seen: string[] = [];
        const sample = () => {
          const t = announced();
          if (seen.at(-1) !== t) seen.push(t);
        };
        for (let i = 1; i <= 8; i++) {
          server.step(() => undefined, i);
          await sleep(60);
          sample();
          expect(scanLine()).toBe(`Checking the repository: ${i} of 20 files`);
        }
        server.finish();
        await until(() => scanLine() === null, 'done');
        sample();
        expect(seen).toEqual([SCAN_STARTED, SCAN_FINISHED]);
      });

      it('a pass over an unchanged repository (nothing left to decide) shows no progress line and says nothing', async () => {
        const server = new FakeServer(repo());
        server.scan = { state: 'running', filesDone: 10, filesTotal: 10, version: 1 };
        mount(view, server);
        await until(() => options().length > 0, 'rows');
        expect(scanLine()).toBeNull();
        expect(announced()).toBe('');
      });

      it("the toggle says how many functions can't run from the server's count, and lists them with reasons, greyed and not selectable", async () => {
        const server = new FakeServer(repo());
        const adapter = mount(view, server);
        await until(() => options().length > 0, 'rows');
        const t = toggle()!;
        expect(t.textContent).toBe("Show 2 functions Faithful can't run");
        expect(t.getAttribute('aria-expanded')).toBe('false');
        expect(root.textContent).not.toContain('liveWorkers');
        await act(async () => t.click());
        const li = [...root.querySelectorAll('.run-list li')];
        expect(li.map((x) => x.textContent)).toEqual([`liveWorkersa/live.ts:4${IMPORT_REASON}`, `browserZ3a/z3.ts:1${GENERIC_REASON}`]);
        expect(li[0]!.getAttribute('aria-disabled')).toBe('true');
        expect(li[0]!.getAttribute('role')).toBeNull();
        await act(async () => (li[0] as HTMLElement).click());
        expect(adapter.openFunction).not.toHaveBeenCalled();
        expect(toggle()!.textContent).toBe("Hide the 2 functions Faithful can't run");
        // they are never among the openable rows
        expect(names()).not.toContain('liveWorkers');
      });

      it("a count above the 200 reasons the server sends is said as it is, with a note on how many are listed", async () => {
        const many = Array.from({ length: 250 }, (_, i) => row(`n/f${i}.ts`, `f${i}`, 'none'));
        const server = new FakeServer([row('z/gcd.ts', 'gcd', 'provable'), ...many]);
        mount(view, server);
        await until(() => options().length > 0, 'rows');
        expect(toggle()!.textContent).toBe("Show 250 functions Faithful can't run");
        await act(async () => toggle()!.click());
        // 20 reasons at first (the page does not grow by two hundred rows), the rest a click at a time
        expect(root.querySelectorAll('.run-list li')).toHaveLength(20);
        expect(root.textContent).not.toContain('The first 200 of them are listed.');
        const more = () => [...root.querySelectorAll('button')].find((b) => /^Show \d+ more/.test(b.textContent ?? ''));
        expect(more()!.textContent).toBe('Show 20 more (180 left)');
        await act(async () => more()!.click());
        expect(root.querySelectorAll('.run-list li')).toHaveLength(40);
        for (let i = 0; i < 20 && more(); i++) await act(async () => more()!.click());
        expect(root.querySelectorAll('.run-list li')).toHaveLength(200);
        expect(more()).toBeUndefined();
        expect(root.textContent).toContain('The first 200 of them are listed.');
      });

      it("a search that matches only functions Faithful can't run lists them with reasons instead of an empty list", async () => {
        const server = new FakeServer(repo());
        const adapter = mount(view, server);
        await until(() => options().length > 0, 'rows');
        type(input(), 'live');
        await until(() => options().length === 0, 'no runnable rows');
        await until(() => root.querySelectorAll('.run-list li').length === 1, 'listed with reasons');
        expect(root.textContent).not.toContain('No exported function matches');
        expect(root.textContent).toContain('No function Faithful can run matches.');
        expect(root.querySelector('.run-list li')!.textContent).toBe(`liveWorkersa/live.ts:4${IMPORT_REASON}`);
        expect(toggle()).toBeUndefined();
        keyOn(input(), 'Enter');
        expect(adapter.openFunction).not.toHaveBeenCalled();
      });

      it('a search with no match at all says so; an empty repository says that instead', async () => {
        const server = new FakeServer(repo());
        mount(view, server);
        await until(() => options().length > 0, 'rows');
        type(input(), 'nothingLikeThis');
        await until(() => options().length === 0, 'empty');
        await until(() => root.textContent!.includes('No exported function matches. You can paste one instead.'), 'said');
        expect(toggle()).toBeUndefined();
        act(() => render(null, root));
        root.remove();
        mount(view, new FakeServer([]));
        await until(() => root.textContent!.includes('No exported functions were found in this repository.'), 'empty repository');
      });

      it('functions that are not decided say why, plainly: still checking, took longer than 3 seconds, the check failed', async () => {
        const server = new FakeServer(repo());
        mount(view, server);
        await until(() => options().length > 0, 'rows');
        type(input(), 'One');
        await until(() => names().sort().join() === 'brokenOne,lateOne,slowOne', 'the three');
        const byName = (n: string) => options().find((o) => o.startsWith(n))!;
        // no scan is running: a function the scan never reached says so, and the other two give the server's own reason
        expect(byName('lateOne')).toBe('lateOneb/late.ts:1Not checked yet');
        expect(byName('slowOne')).toBe(`slowOneb/slow.ts:1${SLOW}`);
        expect(byName('brokenOne')).toBe(`brokenOneb/broken.ts:1${FAILED}`);
        // they are still listed and can be opened (never hidden for lack of an answer), after anything decided
        expect(root.querySelector('[title]')).not.toBeNull();
        expect(root.textContent).not.toContain('Of these:'); // all three are listed and none is decided: the rows say it
        // while the scan runs, the one it has not reached is "Checking…", the others keep their reasons
        server.scan = { state: 'running', filesDone: 1, filesTotal: 10, version: 2 };
        type(input(), 'Two');
        type(input(), 'One');
        await until(() => byName('lateOne').endsWith('Checking…'), 'checking');
        expect(byName('slowOne')).toContain('took longer than 3 seconds');
      });

      it('the highlighted function that leaves the list returns the highlight to the best row, not to whatever now sits where it was', async () => {
        const fns = ['a', 'b', 'c', 'd', 'e'].map((n) => row(`f/${n}.ts`, n, 'tested'));
        const server = new FakeServer(fns);
        server.scan = { state: 'running', filesDone: 0, filesTotal: 5, version: 1 };
        mount(view, server);
        await until(() => options().length === 5, 'rows');
        for (let i = 0; i < 3; i++) keyOn(input(), 'ArrowDown');
        expect(selected()!.textContent).toMatch(/^d/);
        server.step((f) => {
          f[3]!.tier = 'none'; // "d" turns out to be one Faithful can't run
        });
        await until(() => names().length === 4, 'd left');
        expect(names()).toEqual(['a', 'b', 'c', 'e']);
        // not "e", which only happens to sit at d's position now: the person never chose it
        expect(selected()!.textContent).toMatch(/^a/);
        keyOn(input(), 'ArrowDown');
        expect(selected()!.textContent).toMatch(/^b/);
      });

      it('moving the pointer selects a row; a re-rank under a resting pointer does not', async () => {
        const server = new FakeServer([row('f/a.ts', 'a', 'tested'), row('f/b.ts', 'b', 'tested'), row('f/c.ts', 'c', 'unknown', { reason: PENDING })]);
        server.scan = { state: 'running', filesDone: 0, filesTotal: 3, version: 1 };
        mount(view, server);
        await until(() => options().length === 3, 'rows');
        const li = [...root.querySelectorAll<HTMLElement>('[role="option"]')];
        act(() => void li[1]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));
        expect(selected()!.textContent).toMatch(/^b/);
        // a row still being checked is not selected by the pointer
        act(() => void li[2]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));
        expect(selected()!.textContent).toMatch(/^b/);
        act(() => void li[1]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })));
        server.step((f) => (f[2]!.tier = 'tested'));
        await until(() => options().every((o) => o.endsWith('Can be tested')), 're-ranked');
        expect(selected()!.textContent).toMatch(/^b/);
      });

      it('when the window regains focus it asks the server for a new pass and ranks again', async () => {
        const server = new FakeServer(repo());
        const adapter = mount(view, server);
        await until(() => options().length > 0, 'rows');
        const asks = adapter.pickFunctions.mock.calls.length;
        expect(adapter.startScan).not.toHaveBeenCalled();
        // a file changed meanwhile: the new pass finds a provable function
        server.fns.push(row('0/new.ts', 'brandNew', 'provable', { hasJsDoc: true, line: 1 }));
        server.scan = { ...server.scan, version: 2 };
        await act(async () => void window.dispatchEvent(new Event('focus')));
        await until(() => adapter.startScan.mock.calls.length === 1, 'startScan');
        await until(() => names().includes('brandNew'), 'ranked again');
        expect(adapter.pickFunctions.mock.calls.length).toBeGreaterThan(asks);
        expect(names().slice(0, 2)).toEqual(['brandNew', 'gcd']);
        // a failed startScan still asks again
        adapter.startScan.mockRejectedValue(new Error('HTTP 500'));
        const before = adapter.pickFunctions.mock.calls.length;
        await act(async () => void window.dispatchEvent(new Event('focus')));
        await until(() => adapter.pickFunctions.mock.calls.length > before, 'asked despite the failure');
        // coming back to the tab asks too; leaving it does not
        const visibility = (v: 'visible' | 'hidden') => {
          Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
          act(() => void document.dispatchEvent(new Event('visibilitychange')));
        };
        try {
          const starts = adapter.startScan.mock.calls.length;
          visibility('hidden');
          await sleep(60);
          expect(adapter.startScan.mock.calls.length).toBe(starts);
          visibility('visible');
          await until(() => adapter.startScan.mock.calls.length === starts + 1, 'asked when the tab came back');
        } finally {
          delete (document as unknown as Record<string, unknown>).visibilityState;
        }
      });

      it('a replay or fixture (the adapter answers null) lists every function locally, without statuses, a toggle, a scan line or the footnote', async () => {
        const adapter = mount(view, null);
        await until(() => options().length === 3, 'local list');
        expect(options()).toEqual(['fibsrc/math/fib.ts:2', 'fibFloatsrc/math/fib.ts:9', 'gcdsrc/math/gcd.ts:1']);
        expect(toggle()).toBeUndefined();
        expect(root.textContent).not.toContain(CAN_RUN_FOOTNOTE);
        expect(scanLine()).toBeNull();
        expect(adapter.listFiles).toHaveBeenCalledTimes(1);
        expect(adapter.scanStatus).not.toHaveBeenCalled();
        // search is local too
        type(input(), 'gcd');
        await until(() => options().length === 1, 'filtered');
        expect(options()).toEqual(['gcdsrc/math/gcd.ts:1']);
        keyOn(input(), 'Enter');
        expect(adapter.openFunction).toHaveBeenCalledWith('src/math/gcd.ts', 'gcd');
        expect(adapter.pickFunctions).toHaveBeenCalledTimes(1); // asked once, never again
      });

      it('a failed first ask leaves the plain local list and says that the functions are not ranked', async () => {
        const adapter = mount(view, null, (a) => a.pickFunctions.mockRejectedValue(new Error('HTTP 404')));
        await until(() => options().length === 3, 'local list');
        expect(root.textContent).toContain('Could not ask which functions Faithful can run (HTTP 404); every function is listed, without a status.');
        expect(toggle()).toBeUndefined();
        expect(adapter.listFiles).toHaveBeenCalledTimes(1);
      });

      it('a failed listing (local) is reported inline, and pasting stays available', async () => {
        mount(view, null, (a) => a.listFiles.mockRejectedValue(new Error('HTTP 500')));
        await until(() => root.textContent!.includes("Could not list the repository's functions: HTTP 500. You can paste a function instead."), 'said');
        expect(root.textContent).toMatch(/paste a function/i);
      });

      it('a later failed ask keeps the rows, says they may be out of date, and recovers on the next answer', async () => {
        const server = new FakeServer(repo());
        let fail = false;
        const adapter = mount(view, server, (a) => {
          a.pickFunctions.mockImplementation(async (q, o) => {
            if (fail) throw new Error('HTTP 500');
            return server.pick(q, o);
          });
        });
        await until(() => options().length > 0, 'rows');
        fail = true;
        type(input(), 'gcd');
        await until(() => root.textContent!.includes('Could not refresh the list: HTTP 500.'), 'said');
        expect(options().length).toBeGreaterThan(0);
        keyOn(input(), 'Enter'); // the rows answer another query: not opened
        expect(adapter.openFunction).not.toHaveBeenCalled();
        fail = false;
        type(input(), 'gcd ');
        await until(() => names().join() === 'gcd', 'recovered');
        expect(root.textContent).not.toContain('Could not refresh');
      });

      it('a scan that ends while an ask is still on its way is asked about once more (that answer is already out of date)', async () => {
        const server = new FakeServer([row('a/one.ts', 'one', 'unknown', { reason: PENDING }), row('a/two.ts', 'two', 'unknown', { reason: PENDING })]);
        server.scan = { state: 'running', filesDone: 0, filesTotal: 2, version: 1 };
        let slow = false;
        const adapter = mount(view, server, (a) =>
          a.pickFunctions.mockImplementation(async (q, o) => {
            const r = await server.pick(q, o); // ranked now, delivered later
            if (slow) await new Promise((res) => setTimeout(res, 200));
            return r;
          }),
        );
        await until(() => options().length === 2, 'rows');
        slow = true;
        server.step((f) => (f[0]!.tier = 'tested'), 1);
        await until(() => adapter.pickFunctions.mock.calls.length === 2, 'the slow ask started');
        server.step((f) => (f[1]!.tier = 'tested'), 2);
        server.finish();
        slow = false;
        await until(() => scanLine() === null && options().length === 2 && options().every((o) => o.endsWith('Can be tested')), 'final ranking');
        // not one ask per poll tick while the slow one was out: the poll saw the end, skipped asking, and the answer in flight asked again
        expect(adapter.pickFunctions.mock.calls.length).toBe(3);
        expect(announced()).toBe(SCAN_FINISHED);
      });

      it('arrows and Enter move through the runnable rows only, from the first', async () => {
        const server = new FakeServer(repo());
        const adapter = mount(view, server);
        await until(() => options().length > 0, 'rows');
        keyOn(input(), 'ArrowDown');
        keyOn(input(), 'ArrowDown');
        keyOn(input(), 'Enter');
        expect(adapter.openFunction).toHaveBeenCalledWith('z/fib.ts', 'fib');
      });
    });
  }
});

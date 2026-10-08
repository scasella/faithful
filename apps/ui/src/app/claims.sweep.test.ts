// @vitest-environment happy-dom
/**
 * The claim sweep: the rendered text of every screen, in every state we can produce, obeys the claim vocabulary.
 *
 * States: both fixtures × every reachable stage × every event prefix; the dev gallery; and the catch fixture DRIVEN
 * through the real Actions (ScriptedAdapter: the user's own rulings, threshold, an accepted faster-not-proved candidate).
 *
 * Rules, checked on visible text plus user-facing attributes (title, aria-label, placeholder), outside code/prompt blocks:
 *   1. every "Proved" claim has provedSentence(N) NEARBY: in the same claim container (card, panel, section, list item,
 *      dialog) and within 700 characters of it — a sentence somewhere else on the page does not count;
 *   2. no percent sign (or "percent") except the literal "95% CI";
 *   3. no score / grade / rating / accuracy at all, and no "confidence" given as a number;
 *   4. never "for all inputs" (nor "proved for all").
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { provedSentence } from '@faithful/core/tiers';
import { Shell } from './App';
import { Gallery } from '../dev/Gallery';
import { Landing } from '../landing/Landing';
import { ReplayAdapter } from '../adapters/replay';
import { ScriptedAdapter } from '../adapters/scripted';
import type { Adapter, PickOptions, PickResult, ScanStatus } from '../actions';
import pickFixture from '../../../../packages/cli/src/flow/fixtures/pick-response.json';
import { FIXTURES } from '../fixtures';
import { STAGES, attach, createStore, type Store } from '../store';
import { SimpleShell } from '../simple/SimpleApp';

const HEAD = provedSentence(0).split(' The model')[0]!; // "Proved for the Lean model of this function."
const CONTAINERS = '.catch, .panel, section, article, li, dialog, .tier, .evidence-wrap, .ag-agreed, .pv-verdict, main';

export interface Violation {
  rule: string;
  where: string;
  context: string;
}

/** Text of a node, skipping code and verbatim prompt blocks (they are quoted material, not claims). */
function claimText(root: Node): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent ?? '';
    else if (n.nodeType === 1) {
      const el = n as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'pre' || tag === 'script' || tag === 'style' || tag === 'kbd') return;
      const block = !['span', 'b', 'i', 'em', 'strong', 'code', 'a', 'del', 'mark', 'abbr', 'button', 'label'].includes(tag);
      if (block) out += ' ';
      for (const c of Array.from(el.childNodes)) walk(c);
      if (block) out += ' ';
    }
  };
  walk(root);
  return out.replace(/\s+/g, ' ');
}

function attrText(doc: Document): string {
  return Array.from(doc.querySelectorAll('[title], [aria-label], [placeholder]'))
    .map((e) => [e.getAttribute('title'), e.getAttribute('aria-label'), e.getAttribute('placeholder')].filter(Boolean).join(' '))
    .join(' | ');
}

export function sweep(html: string, where: string): Violation[] {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const out: Violation[] = [];
  const text = claimText(doc.body);
  const all = `${text} | ${attrText(doc)}`;

  // 1. "Proved" with its sentence nearby.
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? '';
    if (!/\bProved\b/.test(t)) continue;
    const el = n.parentElement!;
    if (el.closest('pre, code, kbd')) continue;
    if (t.includes(HEAD) && t.replace(HEAD, '').match(/\bProved\b/) === null) continue; // the sentence itself
    const box = el.closest(CONTAINERS) ?? doc.body;
    const boxText = claimText(box);
    const i = boxText.indexOf(t.trim().slice(0, 40));
    const j = boxText.indexOf(HEAD);
    const near = j >= 0 && (i < 0 || Math.abs(j - i) <= 700);
    if (!near) out.push({ rule: '"Proved" without provedSentence(N) nearby', where, context: boxText.slice(0, 200) });
  }

  // 2. percent.
  const noCI = all.replace(/95% CI/g, '');
  const pct = noCI.match(/.{0,40}(%|\bpercent\b).{0,20}/i);
  if (pct) out.push({ rule: 'percent other than "95% CI"', where, context: pct[0] });

  // 3. scores and grades.
  const sc = all.match(/.{0,40}\b(score|scores|scored|grade|graded|rating|accuracy)\b.{0,20}/i);
  if (sc) out.push({ rule: 'score / grade / rating / accuracy', where, context: sc[0] });
  const conf = all.match(/.{0,40}\bconfidence\b\s*(?:of|:|=|is)?\s*\d.{0,20}/i) ?? all.match(/\d[\d.]*\s*(?:\/\s*(?:10|100)\b)?\s*confidence\b/i);
  if (conf) out.push({ rule: 'confidence as a number', where, context: conf[0] });
  const outOf = all.match(/.{0,30}\b\d+\s*\/\s*(?:5|10|100)\b(?!\s*(?:ns|ms)).{0,10}/);
  if (outOf && !/\d+\s*\/\s*\d+\s*(?:broken|inputs)/.test(outOf[0])) out.push({ rule: 'n/10-style rating', where, context: outOf[0] });

  // 4. never "for all inputs".
  const fa = all.match(/.{0,40}(for all inputs|proved for all|every possible input).{0,20}/i);
  if (fa) out.push({ rule: '"for all inputs"', where, context: fa[0] });
  return out;
}

function renderAllStages(store: Store, adapter: Adapter, replay: ReplayAdapter | undefined, title: string, where: string): Violation[] {
  const out: Violation[] = [];
  const keep = store.viewing.value;
  for (const st of STAGES) {
    if (!store.reachable(st.id)) continue;
    store.go(st.id);
    out.push(...sweep(renderToString(h(Shell, { store, adapter, replay, fixtureTitle: title })), `${where} / ${st.id}`));
  }
  store.viewing.value = keep;
  return out;
}

describe('claim sweep: the checker itself', () => {
  it('flags each kind of violation and accepts the exact vocabulary', () => {
    const ok = `<section><span class="tier-label">Proved</span><p>${provedSentence(1000)}</p></section><p>4.2× (95% CI 3.9–4.6)</p>`;
    expect(sweep(ok, 't')).toEqual([]);
    const far = `<section><p>Proved against the agreed spec.</p></section><section><p>${provedSentence(1)}</p></section>`;
    expect(sweep(far, 't').map((v) => v.rule)).toEqual(['"Proved" without provedSentence(N) nearby']);
    expect(sweep('<p>99% of inputs</p>', 't')[0]?.rule).toBe('percent other than "95% CI"');
    expect(sweep('<p>Score 9</p>', 't')[0]?.rule).toBe('score / grade / rating / accuracy');
    expect(sweep('<p>confidence: 0.93</p>', 't')[0]?.rule).toBe('confidence as a number');
    expect(sweep('<p>8/10</p>', 't')[0]?.rule).toBe('n/10-style rating');
    expect(sweep('<p>It is correct for all inputs.</p>', 't')[0]?.rule).toBe('"for all inputs"');
    expect(sweep('<button title="accuracy 99">x</button>', 't').length).toBeGreaterThan(0);
    // Quoted code and prompts are not claims.
    expect(sweep('<pre>theorem Proved_x</pre>', 't')).toEqual([]);
    expect(sweep('<p>12 of 12 broken copies caught</p>', 't')).toEqual([]);
  });
});

describe('claim sweep: every screen of every fixture, after every event', () => {
  for (const fx of Object.values(FIXTURES)) {
    it(`fixture "${fx.name}"`, () => {
      const out: Violation[] = [];
      for (let i = 1; i <= fx.events.length; i++) {
        const store = createStore();
        store.reset(fx.events.slice(0, i));
        const replay = new ReplayAdapter(fx.events, { label: fx.title, fixture: true });
        out.push(...renderAllStages(store, replay, replay, fx.title, `${fx.name} after event ${i} (${fx.events[i - 1]!.event.kind})`));
      }
      expect(out).toEqual([]);
    });
  }

  it('the dev gallery', () => {
    expect(sweep(renderToString(h(Gallery, {})), 'gallery')).toEqual([]);
  });

  it('the landing page, both variants', () => {
    for (const variant of ['showcase', 'local'] as const) expect(sweep(renderToString(h(Landing, { variant })), `landing (${variant})`)).toEqual([]);
  });
});

describe('claim sweep: jobs running and failed', () => {
  it('a running job and a failed one, on every stage', () => {
    const fx = FIXTURES.catch!;
    const store = createStore();
    store.reset([...fx.events, { seq: fx.events.length, t: 0, event: { kind: 'job.failed', job: 'deliver', message: 'Lean exited with code 1' } }]);
    const replay = new ReplayAdapter(fx.events, { label: fx.title, fixture: true });
    const out = renderAllStages(store, replay, replay, fx.title, 'job failed');
    store.push({ kind: 'job.started', job: 'optimize' });
    out.push(...renderAllStages(store, replay, replay, fx.title, 'job running'));
    expect(out).toEqual([]);
  });
});

describe('claim sweep: the catch fixture driven through the Actions', () => {
  it('Select → Translate → Agree (own ruling, carve-out from the menu) → Prove → Optimize (accept faster-not-proved) → Deliver', async () => {
    const fx = FIXTURES.catch!;
    const store = createStore();
    const adapter = new ScriptedAdapter(fx.events, { label: fx.title, stepMs: 0 });
    attach(store, adapter);
    const out: Violation[] = [];
    const check = (where: string) => out.push(...renderAllStages(store, adapter, undefined, `${fx.title} (driven)`, `driven: ${where}`));
    const settle = () => adapter.idle();

    check('start');
    const [file] = await adapter.listFiles();
    await adapter.openFunction(file!.path, file!.functions[0]!.name);
    check('translated');
    await adapter.proposeSpec();
    await settle();
    expect(store.state.value.stage).toBe('agree');
    check('challenged');
    const [c1] = store.state.value.challengeRuns.at(-1)!.disagreements;
    const menu = await adapter.carveOptions(c1!.id);
    expect(menu.map((o) => o.cls.kind)).toEqual(['negative', 'equals', 'exact-input']);
    check('carve menu');
    // "n is negative": the class the fixture recorded; the server re-runs the challenge, which then finds none.
    await adapter.rule(c1!.id, { ruling: 'function-wrong', then: 'carve-out', carve: menu[0]!.cls });
    await settle();
    expect(store.state.value.carveOuts.length).toBe(1);
    expect(store.state.value.challengeRuns.at(-1)!.disagreements).toEqual([]);
    check('carved out');
    await adapter.agree();
    expect(store.state.value.agreement).not.toBeNull();
    check('agreed');
    await adapter.proveOriginal({ maxAttempts: 4, minutes: 7 });
    await settle();
    expect(store.state.value.proofs.at(-1)!.budget).toEqual({ maxAttempts: 4, minutes: 7 });
    expect(store.state.value.job).toEqual({ running: null, lastError: null });
    check('proved');
    await adapter.startOptimize({ kind: 'time-budget', minutes: 10 });
    await settle();
    expect(store.state.value.optimize.stoppedBy).not.toBeNull();
    check('optimized');
    const fnp = store.state.value.optimize.candidates.find((c) => c.outcome === 'faster-not-proved');
    expect(fnp).toBeDefined();
    await adapter.acceptFasterNotProved(fnp!.id);
    expect(store.state.value.optimize.incumbentId).toBe(fnp!.id);
    check('accepted at Verified to k');
    await adapter.deliver();
    expect(store.state.value.stage).toBe('deliver');
    check('delivered');
    expect(out).toEqual([]);
  });
});

describe('claim sweep: the Simple view', () => {
  for (const fx of Object.values(FIXTURES)) {
    it(`fixture "${fx.name}", after every event, replayed and live-looking`, () => {
      const out: Violation[] = [];
      for (let i = 0; i <= fx.events.length; i++) {
        const store = createStore();
        store.reset(fx.events.slice(0, i));
        const replay = new ReplayAdapter(fx.events, { label: fx.title, fixture: true });
        const scripted = new ScriptedAdapter(fx.events, { label: fx.title, stepMs: 0 });
        const where = `simple: ${fx.name} after event ${i}${i ? ` (${fx.events[i - 1]!.event.kind})` : ''}`;
        for (const [html, how] of [
          [renderToString(h(SimpleShell, { store, adapter: replay, fixtureTitle: fx.title })), 'replay'],
          [renderToString(h(SimpleShell, { store, adapter: scripted, onFull: () => undefined })), 'live'],
        ] as const) {
          out.push(...sweep(html, `${where}, ${how}`));
          // no keyboard-shortcut chips and no stepper, on any step
          if (html.includes('<kbd') || html.includes('class="stepper')) out.push({ rule: 'kbd chip or stepper in the Simple view', where, context: how });
        }
      }
      expect(out).toEqual([]);
    });
  }
});

describe('claim sweep: the pick lists over the server\'s ranking (what Faithful can attempt, the can\'t-run list and its reasons, the scan line)', () => {
  /**
   * The text the SERVER supplies (reasons quote compiler and extractor output) goes through the sweep too: the fixture is
   * what the real server answers for a small repository (packages/cli/src/flow/fixtures/pick-response.json, kept equal to
   * the real answer by a test there), including a reason that quotes "50 mod of the budget" where the source had a percent sign.
   */
  type Row = PickResult['rows'][number];
  const rowOf = (file: string, name: string, tier: Row['tier'], reason: string | null = null): Row => ({ file, name, line: 1, hasJsDoc: false, tier, reason });
  const undecided: Row[] = [
    rowOf('u/pending.ts', 'pendingOne', 'unknown', 'Not checked yet: the scan has not reached it.'),
    rowOf('u/slow.ts', 'slowOne', 'unknown', 'Checking took longer than 3 seconds; not run.'),
    rowOf('u/failed.ts', 'failedOne', 'unknown', 'The check itself failed; not run.'),
  ];
  const fx = pickFixture as unknown as PickResult;

  /** A server that answers from a table by name/path match, ranked provable, tested, unknown, as the real one does. */
  function serverFor(table: Row[], scan: ScanStatus) {
    const order = { provable: 0, tested: 1, unknown: 2, none: 3 } as const;
    return async (query: string, o: PickOptions = {}): Promise<PickResult> => {
      const q = query.trim().toLowerCase();
      const all = table.filter((r) => !q || r.name.toLowerCase().includes(q) || r.file.toLowerCase().includes(q)).sort((a, b) => order[a.tier] - order[b.tier]);
      const counts = { provable: 0, tested: 0, unknown: 0, none: 0 };
      for (const r of all) counts[r.tier]++;
      return {
        rows: all.filter((r) => r.tier !== 'none').slice(0, o.limit ?? 8),
        totalMatches: all.length,
        counts,
        cannotRun: o.includeUnrunnable ? all.filter((r) => r.tier === 'none') : [],
        scan,
      };
    };
  }

  it('the fixture itself carries no percent sign, and every reason of it reads as a claim-free sentence', () => {
    for (const r of [...fx.rows, ...fx.cannotRun]) expect(sweep(`<li><p>${r.reason ?? ''}</p></li>`, `fixture reason of ${r.name}`)).toEqual([]);
    expect(JSON.stringify(fx)).not.toContain('%');
  });

  it('Select and the Simple Pick step: the fixture answer, a running scan with every kind of undecided function, the can\'t-run list opened, a search that finds only functions that can\'t run', async () => {
    const { render } = await import('preact');
    const { act } = await import('preact/test-utils');
    const { AppContext } = await import('./AppContext');
    const { SelectScreen } = await import('../screens/select/SelectScreen');
    const { PickStep } = await import('../simple/PickStep');
    const { fakeAdapter, storeWith } = await import('../screens/agree/testkit');
    const { PICK_TIMING } = await import('../screens/select/pickView');
    const saved = { ...PICK_TIMING };
    Object.assign(PICK_TIMING, { debounceMs: 20, pollMs: 40, focusMs: 0 });
    const table: Row[] = [...fx.rows, ...fx.cannotRun, ...undecided];
    const sleep = (ms: number) => act(async () => await new Promise((r) => setTimeout(r, ms)));
    const out: Violation[] = [];
    try {
      for (const [name, Screen] of [['select', SelectScreen], ['simple pick', PickStep]] as const) {
        for (const [state, scan] of [
          ['scan done', { state: 'done', filesDone: 10, filesTotal: 10, version: 4 }],
          ['scan running', { state: 'running', filesDone: 3, filesTotal: 10, version: 4 }],
        ] as const) {
          const root = document.createElement('div');
          document.body.append(root);
          const adapter = fakeAdapter([]);
          adapter.pickFunctions.mockImplementation(serverFor(table, scan));
          adapter.scanStatus.mockImplementation(async () => ({ ...scan }));
          act(() => render(h(AppContext.Provider, { value: { store: storeWith([]), adapter } }, h(Screen as never, {})), root));
          for (let i = 0; i < 100 && !root.querySelector('.run-toggle'); i++) await sleep(10);
          const toggle = root.querySelector<HTMLButtonElement>('.run-toggle');
          expect(toggle, `${name}, ${state}`).not.toBeNull();
          expect(root.querySelectorAll('[role="option"]').length, `${name}, ${state}`).toBe(fx.rows.length + undecided.length);
          expect(!!root.querySelector('.run-scan'), `${name}, ${state}`).toBe(state === 'scan running');
          out.push(...sweep(root.innerHTML, `${name}, ${state}, list`));
          await act(async () => toggle!.click());
          expect(root.querySelectorAll('.run-list li').length, `${name}, ${state}`).toBe(fx.cannotRun.length);
          // every reason of the fixture is on the page, the one that quoted a percent sign included
          expect(root.textContent, name).toContain('Error: 50 mod of the budget');
          out.push(...sweep(root.innerHTML, `${name}, ${state}, can't-run list opened`));
          // a search that matches only functions Faithful can't run: they are listed with their reasons
          const input = root.querySelector<HTMLInputElement>('input[role="combobox"]')!;
          act(() => {
            input.value = 'limit';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          for (let i = 0; i < 100 && !root.textContent!.includes('No function Faithful can run matches.'); i++) await sleep(10);
          expect(root.textContent, name).toContain('No function Faithful can run matches.');
          out.push(...sweep(root.innerHTML, `${name}, ${state}, only unrunnable matches`));
          act(() => render(null, root));
          root.remove();
        }
        // a replay or fixture: the plain local list, without statuses
        const root = document.createElement('div');
        document.body.append(root);
        const adapter = fakeAdapter([{ path: 'a.ts', functions: [{ name: 'p', line: 1, hasJsDoc: false }] }]);
        act(() => render(h(AppContext.Provider, { value: { store: storeWith([]), adapter } }, h(Screen as never, {})), root));
        for (let i = 0; i < 100 && !root.querySelector('[role="option"]'); i++) await sleep(10);
        expect(root.querySelectorAll('[role="option"]').length, name).toBe(1);
        out.push(...sweep(root.innerHTML, `${name}, local list`));
        act(() => render(null, root));
        root.remove();
      }
    } finally {
      Object.assign(PICK_TIMING, saved);
    }
    expect(out).toEqual([]);
  });

  it('the count notes of every stage of a scan (in file order, best so far, final) and the plain-word reasons the server writes now', async () => {
    const { render } = await import('preact');
    const { act } = await import('preact/test-utils');
    const { AppContext } = await import('./AppContext');
    const { SelectScreen } = await import('../screens/select/SelectScreen');
    const { PickStep } = await import('../simple/PickStep');
    const { fakeAdapter, storeWith } = await import('../screens/agree/testkit');
    const { PICK_TIMING } = await import('../screens/select/pickView');
    const saved = { ...PICK_TIMING };
    Object.assign(PICK_TIMING, { debounceMs: 20, pollMs: 40, focusMs: 0 });
    const sleep = (ms: number) => act(async () => await new Promise((r) => setTimeout(r, ms)));
    const out: Violation[] = [];
    // reasons as `pickReason` writes them for a name the file does not define, a compiler diagnostic, and the translator clause
    const plain: Row[] = [
      rowOf('p/doc.ts', 'readTitle', 'none', 'Cannot run on its own: it uses `document`, which the file does not define and a plain function run does not provide (line 2, column 10). The translator refuses it too (input or output).'),
      rowOf('p/ret.ts', 'noReturn', 'none', "Cannot run on its own: it and the declarations it uses do not compile by themselves (line 5, column 3: Function lacks ending return statement and return type does not include 'undefined'). The translator refuses it too (syntax outside the subset)."),
      rowOf('p/slowfile.ts', 'hugeFile', 'unknown', 'Checking took longer than 30 seconds; not run.'),
    ];
    for (const r of plain) out.push(...sweep(`<li><p>${r.reason}</p></li>`, `reason of ${r.name}`));
    try {
      for (const [name, Screen] of [['select', SelectScreen], ['simple pick', PickStep]] as const) {
        const many = Array.from({ length: 60 }, (_, i) => rowOf(`m/f${String(i).padStart(2, '0')}.ts`, `f${String(i).padStart(2, '0')}`, 'unknown', 'Not checked yet: the scan has not reached it.'));
        const stages: Array<[string, Row[], ScanStatus, RegExp]> = [
          ['nothing decided yet', [...many, ...plain], { state: 'running', filesDone: 0, filesTotal: 60, version: 1 }, /in file order, not ranked yet/],
          ['some decided', [rowOf('m/g.ts', 'g', 'provable'), ...many.map((r, i) => (i < 3 ? { ...r, tier: 'tested' as const, reason: null } : r)), ...plain], { state: 'running', filesDone: 5, filesTotal: 60, version: 2 }, /the best so far/],
          ['final', [rowOf('m/g.ts', 'g', 'provable'), ...many.map((r) => ({ ...r, tier: 'tested' as const, reason: null })), ...plain], { state: 'done', filesDone: 60, filesTotal: 60, version: 3 }, /Showing the best \d+ of \d+: 1 can have a proof attempted, 60 can be tested, 1 not checked/],
        ];
        for (const [stage, table, scan, note] of stages) {
          const root = document.createElement('div');
          document.body.append(root);
          const adapter = fakeAdapter([]);
          adapter.pickFunctions.mockImplementation(serverFor(table, scan));
          adapter.scanStatus.mockImplementation(async () => ({ ...scan }));
          act(() => render(h(AppContext.Provider, { value: { store: storeWith([]), adapter } }, h(Screen as never, {})), root));
          for (let i = 0; i < 100 && !root.querySelector('[role="option"]'); i++) await sleep(10);
          expect(root.textContent, `${name}, ${stage}`).toMatch(note);
          out.push(...sweep(root.innerHTML, `${name}, ${stage}`));
          // the can't-run list with its first page of reasons
          const toggle = root.querySelector<HTMLButtonElement>('.run-toggle');
          if (toggle) {
            await act(async () => toggle.click());
            out.push(...sweep(root.innerHTML, `${name}, ${stage}, can't-run list opened`));
          }
          act(() => render(null, root));
          root.remove();
        }
      }
    } finally {
      Object.assign(PICK_TIMING, saved);
    }
    expect(out).toEqual([]);
  });

  it('the sweep does catch a raw percent sign in a server reason (the server writes it as "mod"; the page does not rewrite it)', () => {
    expect(sweep('<ul><li><span class="run-reason">Error: 50% of the budget</span></li></ul>', 'hostile reason').map((v) => v.rule)).toEqual(['percent other than "95% CI"']);
  });
});

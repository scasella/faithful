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
import { ReplayAdapter } from '../adapters/replay';
import { ScriptedAdapter } from '../adapters/scripted';
import type { Adapter } from '../actions';
import { FIXTURES } from '../fixtures';
import { STAGES, attach, createStore, type Store } from '../store';

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

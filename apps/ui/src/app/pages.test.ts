/** Whole-page checks: the claim rules hold on every screen of every fixture, and on the gallery. */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { Shell } from './App';
import { Gallery } from '../dev/Gallery';
import { ReplayAdapter } from '../adapters/replay';
import { FIXTURES, FIXTURE_NOTICE } from '../fixtures';
import { STAGES, createStore } from '../store';
import { assertClaimsExact, stripElements, visibleText } from '../test/text';

describe('pages', () => {
  for (const fx of Object.values(FIXTURES)) {
    it(`fixture "${fx.name}": every reachable screen obeys the claim rules and carries the fixture banner`, () => {
      const store = createStore();
      store.reset(fx.events);
      const adapter = new ReplayAdapter(fx.events, { label: fx.title, fixture: true });
      for (const st of STAGES) {
        if (!store.reachable(st.id)) continue;
        store.go(st.id);
        const text = visibleText(renderToString(h(Shell, { store, adapter, replay: adapter, fixtureTitle: fx.title })));
        expect(text).toContain(FIXTURE_NOTICE);
        assertClaimsExact(text);
      }
    });
  }

  it('the gallery obeys the claim rules', () => {
    const text = visibleText(renderToString(h(Gallery, {})));
    expect(text).toContain(FIXTURE_NOTICE);
    expect(text).toContain('Caught: the candidate differs from the original');
    assertClaimsExact(text);
  });

  it('"What the model saw" sits under every spec proposal, proof attempt and candidate', () => {
    const fx = FIXTURES.catch!;
    const store = createStore();
    store.reset(fx.events);
    const adapter = new ReplayAdapter(fx.events, { label: fx.title, fixture: true });
    const count = (stage: 'agree' | 'prove' | 'optimize') => {
      store.go(stage);
      return (renderToString(h(Shell, { store, adapter })).match(/What the model saw/g) ?? []).length;
    };
    const s = store.state.value;
    expect(count('agree')).toBeGreaterThanOrEqual(s.proposals.length);
    expect(count('prove')).toBeGreaterThanOrEqual(s.proofs.reduce((n, p) => n + p.attempts.length, 0));
    expect(count('optimize')).toBeGreaterThanOrEqual(s.optimize.candidates.length);
  });

  it('the refused fixture marks the exact refused span', () => {
    const fx = FIXTURES.refused!;
    const store = createStore();
    store.reset(fx.events);
    const html = renderToString(h(Shell, { store, adapter: new ReplayAdapter(fx.events, { label: '', fixture: true }) }));
    expect(visibleText(html.match(/<mark class="span">[\s\S]*?<\/mark>(?:<mark class="span">[\s\S]*?<\/mark>)*/)![0]).replace(/\s/g, '')).toBe('sum/xs.length');
  });
});

/** Remove everything that legitimately shows numbers without a popover: provenance triggers themselves, code/prompt
 *  blocks, key caps and line numbers. What remains must not contain a measured figure. */
function unprovenanced(html: string): string {
  return visibleText(
    stripElements(html, 'span', 'prov-trigger')
      .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
      .replace(/<kbd>[\s\S]*?<\/kbd>/g, ' '),
  );
}
const MEASURED = /[\d.]+ ?ns\/call|[\d.]+×|k=\d|\d[\d,]* (?:inputs|trials|tried|broken copies|tokens|disagreements|of \d)|\d+ ms\b|95% CI [\d.]/;

describe('provenance', () => {
  for (const fx of Object.values(FIXTURES)) {
    it(`fixture "${fx.name}": every measured number on every screen sits inside a provenance trigger`, () => {
      const store = createStore();
      store.reset(fx.events);
      const adapter = new ReplayAdapter(fx.events, { label: fx.title, fixture: true });
      for (const st of STAGES) {
        if (!store.reachable(st.id)) continue;
        store.go(st.id);
        const rest = unprovenanced(renderToString(h(Shell, { store, adapter })));
        expect(rest.match(MEASURED)?.[0] ?? null, `${st.id}: ${rest.slice(Math.max(0, rest.search(MEASURED) - 80), rest.search(MEASURED) + 40)}`).toBeNull();
      }
    });
  }
});

describe('intermediate states', () => {
  for (const fx of Object.values(FIXTURES)) {
    it(`fixture "${fx.name}": the current screen renders and obeys the claim rules after every event`, () => {
      const adapter = new ReplayAdapter(fx.events, { label: fx.title, fixture: true });
      for (let i = 1; i <= fx.events.length; i++) {
        const store = createStore();
        store.reset(fx.events.slice(0, i));
        const html = renderToString(h(Shell, { store, adapter }));
        assertClaimsExact(visibleText(html));
        expect(unprovenanced(html).match(MEASURED)?.[0] ?? null, `after event ${i}`).toBeNull();
      }
    });
  }

  it('right after the original is proved (no candidate yet) the Proved label is withheld, not shown bare', () => {
    const fx = FIXTURES.catch!;
    const i = fx.events.findIndex((e) => e.event.kind === 'proof.done') + 1;
    const store = createStore();
    store.reset(fx.events.slice(0, i));
    const text = visibleText(renderToString(h(Shell, { store, adapter: new ReplayAdapter(fx.events, { label: '', fixture: true }) })));
    expect(text).toContain('Lean proof accepted');
    expect(text).toContain('Label withheld');
    expect(text).not.toMatch(/\bProved\b/);
  });
});

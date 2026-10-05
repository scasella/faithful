/** Translate: refusal span rendering, the throw choice gate, and the precondition list shared with Agree. */
import { describe, expect, it } from 'vitest';
import type { SessionEvent, StampedEvent } from '@faithful/session';
import type { Span, Translation } from '@faithful/translate';
import { ReplayAdapter } from '../../adapters/replay';
import { NO_THROW_WORDS } from '../../components/Preconditions';
import { catchFixture } from '../../fixtures/catch';
import { spanOf } from '../../fixtures/common';
import { refusedFixture } from '../../fixtures/refused';
import { assertClaimsExact, visibleText } from '../../test/text';
import { AgreeScreen } from '../agree/AgreeScreen';
import { buttonTag, fakeAdapter, isDisabled, renderScreen, storeWith } from '../agree/testkit';
import { REFUSAL_TITLE, lineExcerpt, tyWords } from './refusal';
import { TranslateScreen, proposeBlocker } from './TranslateScreen';

/** Visible text of every <mark class="span"> run, in order, joined. */
function marked(html: string): string {
  return [...html.matchAll(/<mark class="span">([\s\S]*?)<\/mark>/g)].map((m) => visibleText(m[1]!)).join('');
}

const refusedStore = () => storeWith(refusedFixture.events);
const roAdapter = (events: StampedEvent[]) => new ReplayAdapter(events, { label: '', fixture: true });

describe('refused', () => {
  it('shows the translator reason, the code, the position and marks exactly the refused span', () => {
    const store = refusedStore();
    const r = store.state.value.translation;
    if (!r || r.ok) throw new Error('fixture should be refused');
    const html = renderScreen(TranslateScreen, store, roAdapter(refusedFixture.events));
    const text = visibleText(html);
    expect(marked(html)).toBe('sum / xs.length');
    // The reason is verbatim; its `backtick` spans render as <code>, so the visible text has no literal backticks.
    expect(text).toContain(r.refusal.reason.replace(/`/g, ''));
    expect(html).toMatch(/<code[^>]*>sum \/ xs.length<\/code>/);
    expect(text).toContain(REFUSAL_TITLE.float);
    expect(text).toContain(`Refusal code float · line ${r.refusal.span.line}, column ${r.refusal.span.column}`);
    expect(r.refusal.span).toMatchObject({ line: 6, column: 10 });
    expect(html).toContain('class="line has-mark"');
  });

  it('says what still runs (Tested = differential + mutation) and never implies the proof tier', () => {
    const text = visibleText(renderScreen(TranslateScreen, refusedStore(), roAdapter(refusedFixture.events)));
    expect(text).toContain('The Tested tier: differential testing');
    expect(text).toContain('mutation testing');
    expect(text).toContain('The proof tier is not available for this function.');
    expect(text).not.toMatch(/\bProved\b|Verified to/);
    expect(text).not.toMatch(/Propose a spec/);
    assertClaimsExact(text);
  });

  it('marks a span that crosses lines, character for character', () => {
    const source = 'export function f(xs: number[]): number {\n  return xs.reduce(\n    (a, b) => a + b, 0) / 2;\n}\n';
    const needle = 'xs.reduce(\n    (a, b) => a + b, 0) / 2';
    const events: SessionEvent[] = [
      { ...(refusedFixture.events[0]!.event as Extract<SessionEvent, { kind: 'session.started' }>), fn: 'f', source },
      { kind: 'translate.done', result: { ok: false, refusal: { code: 'float', reason: 'bare division', span: spanOf(source, needle) } } },
    ];
    const html = renderScreen(TranslateScreen, storeWith(events), fakeAdapter());
    expect(marked(html).replace(/\s+/g, ' ')).toBe(needle.replace(/\s+/g, ' '));
    expect((html.match(/class="line has-mark"/g) ?? []).length).toBe(2);
  });

  it('has a plain-words title for every refusal code', () => {
    for (const [code, title] of Object.entries(REFUSAL_TITLE)) {
      expect(title.length, code).toBeGreaterThan(3);
      expect(title, code).not.toMatch(/%|score|grade/i);
    }
  });
});

describe('lineExcerpt', () => {
  const src = 'line one\nconst x = a / b;\nline three';
  it('returns the whole line with the span re-based', () => {
    const sp = spanOf(src, 'a / b');
    const ex = lineExcerpt(src, sp);
    expect(ex).toEqual({ text: 'const x = a / b;', mark: { start: 10, end: 15 }, from: 2 });
    expect(ex.text.slice(ex.mark.start, ex.mark.end)).toBe('a / b');
  });
  it('first and last line, and a span over two lines', () => {
    expect(lineExcerpt(src, spanOf(src, 'line one'))).toMatchObject({ text: 'line one', from: 1 });
    expect(lineExcerpt(src, spanOf(src, 'three'))).toMatchObject({ text: 'line three', from: 3 });
    const two = lineExcerpt(src, spanOf(src, 'b;\nline'));
    expect(two.text).toBe('const x = a / b;\nline three');
    expect(two.text.slice(two.mark.start, two.mark.end)).toBe('b;\nline');
  });
  it('adds context lines on request', () => {
    expect(lineExcerpt(src, spanOf(src, 'a / b'), 1)).toMatchObject({ text: src, from: 1 });
  });
});

// A translation that can throw, built from the catch fixture's translate.done.
const THROW_SRC = `export function fact(n: number): number {
  if (n < 0) throw new Error("negative");
  let r = 1;
  for (let i = 2; i <= n; i++) r = r * i;
  return r;
}
`;
const base = catchFixture.events.slice(0, 2).map((e) => e.event);
const started = { ...(base[0] as Extract<SessionEvent, { kind: 'session.started' }>), fn: 'fact', source: THROW_SRC };
const okT = (base[1] as Extract<SessionEvent, { kind: 'translate.done' }>).result as { ok: true; value: Translation };
const throwSpan: Span = spanOf(THROW_SRC, 'throw new Error("negative");');
const throwing: SessionEvent = {
  kind: 'translate.done',
  result: {
    ok: true,
    value: { ...okT.value, fnName: 'fact', canThrow: true, throwSites: [{ message: 'negative', span: throwSpan }], source: { text: THROW_SRC, hash: 'h' }, notes: ['UTF-16 gap'] },
  },
};

describe('translated', () => {
  it('a function that can throw: lists the site with its exact span, and "Propose a spec" waits for the choice', () => {
    const store = storeWith([started, throwing]);
    const html = renderScreen(TranslateScreen, store, fakeAdapter());
    const text = visibleText(html);
    expect(marked(html)).toBe('throw new Error("negative");');
    expect(text).toContain(`Throws "negative" at line ${throwSpan.line}, column ${throwSpan.column}`);
    expect(isDisabled(buttonTag(html, 'Propose a spec'))).toBe(true);
    expect(text).toContain('Choose how to treat the throw first (p or c).');
    expect(isDisabled(buttonTag(html, 'Treat as a precondition'))).toBe(false);
    expect(isDisabled(buttonTag(html, 'Model as a spec case'))).toBe(false);
    expect(text).toContain('UTF-16 gap');
  });

  it('after choosing, the spec can be proposed and the choice shows', () => {
    const store = storeWith([started, throwing, { kind: 'throw.choice', choice: 'spec-case' }]);
    const html = renderScreen(TranslateScreen, store, fakeAdapter());
    expect(proposeBlocker(store.state.value)).toBeNull();
    expect(isDisabled(buttonTag(html, 'Propose a spec'))).toBe(false);
    expect(visibleText(html)).toContain('Chosen.');
  });

  it('the Lean model is collapsed by default and the preconditions are in plain words', () => {
    const store = storeWith(catchFixture.events.slice(0, 2));
    const html = renderScreen(TranslateScreen, store, fakeAdapter());
    expect(html).toMatch(/<details class="tr-model">/);
    const text = visibleText(html);
    expect(text).toContain('n is an integer with |n| ≤ 2^53.');
    expect(text).toContain('No overflow');
    expect(text).toContain('No model call was involved.');
    expect(tyWords({ k: 'option', inner: { k: 'array', elem: { k: 'int' } } })).toBe('array of integer or nothing');
    assertClaimsExact(text);
  });

  it('the precondition sentences are exactly the ones the Agree screen shows', () => {
    // The first precondition list on each page: on Agree that is the on-page section, not the confirmation dialog.
    const words = (html: string) =>
      [...html.match(/<ul class="pre-list">[\s\S]*?<\/ul>/)![0].matchAll(/<span class="pre-words">([\s\S]*?)<\/span>/g)].map((m) => visibleText(m[1]!).trim());
    const extra: SessionEvent[] = catchFixture.events.slice(2, 5).map((e) => e.event);
    const events = [started, throwing, { kind: 'throw.choice', choice: 'precondition' } as SessionEvent, ...extra];
    const store = storeWith(events);
    const tr = words(renderScreen(TranslateScreen, store, fakeAdapter()));
    const ag = words(renderScreen(AgreeScreen, store, fakeAdapter()));
    expect(tr).toContain(NO_THROW_WORDS);
    expect(tr.length).toBe(3);
    expect(ag).toEqual(tr);
    const agHtml = renderScreen(AgreeScreen, store, fakeAdapter());
    expect(agHtml.indexOf('class="pre-list"')).toBeLessThan(agHtml.indexOf('<dialog'));
  });

  it('after agreeing, the Agree screen shows the agreement\'s own precondition list', () => {
    const store = storeWith(catchFixture.events.slice(0, catchFixture.events.findIndex((e) => e.event.kind === 'spec.agreed') + 1));
    store.go('agree');
    const text = visibleText(renderScreen(AgreeScreen, store, fakeAdapter()));
    for (const p of store.state.value.agreement!.preconditions) expect(text).toContain(p.words);
  });
});

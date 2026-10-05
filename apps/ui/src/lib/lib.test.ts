import { describe, expect, it } from 'vitest';
import { tokenize, toLines } from './highlight';
import { bindingOf, isTypingTarget } from './keys';
import { canSayFaster, ceil1, floor1, msText, outcomeVerb, ratioText, speedupCiText, speedupDecimals, valText } from './format';
import { stampOf, provenanceRows } from './provenance';
import { FIXTURE_TOOLCHAIN } from '../fixtures/common';
import { createStore } from '../store';
import { FIXTURES } from '../fixtures';
import { CANDIDATE_TWO_STEP, FIB_LEAN_MODEL } from '../fixtures/catch';

describe('highlight', () => {
  it('tokens cover the input exactly (TypeScript and Lean)', () => {
    for (const [src, lang] of [
      [CANDIDATE_TWO_STEP, 'ts'],
      [FIB_LEAN_MODEL, 'lean'],
    ] as const) {
      expect(tokenize(src, lang).map((t) => t.text).join('')).toBe(src);
    }
  });
  it('classifies keywords, numbers, strings and the turnstile', () => {
    const ts = tokenize('return "a" + 12; // c', 'ts');
    expect(ts.filter((t) => t.kind !== 'plain').map((t) => [t.kind, t.text])).toEqual([
      ['kw', 'return'],
      ['str', '"a"'],
      ['op', '+'],
      ['num', '12'],
      ['com', '// c'],
    ]);
    expect(tokenize('⊢ x = 1', 'lean')[0]).toEqual({ kind: 'goal', text: '⊢' });
  });
  it('marks a span across tokens and lines', () => {
    const text = 'let a = 1;\nreturn a / b;';
    const start = text.indexOf('a / b');
    const lines = toLines(tokenize(text, 'ts'), { start, end: start + 5 });
    expect(lines.length).toBe(2);
    expect(lines[0]!.some((s) => s.marked)).toBe(false);
    expect(lines[1]!.filter((s) => s.marked).map((s) => s.text).join('')).toBe('a / b');
  });
});

describe('format', () => {
  it('never rounds up a claim', () => {
    expect(floor1(4.29)).toBe('4.2');
    expect(floor1(4.2)).toBe('4.2');
    expect(ceil1(4.51)).toBe('4.6');
    expect(ceil1(4.6)).toBe('4.6');
  });
  it('a speedup near 1 prints enough decimals that the interval never contradicts "faster"', () => {
    const s = { ratio: 1.1, lo: 1.04, hi: 1.16, significant: true };
    expect(ratioText(s)).toBe('1.10×');
    expect(speedupCiText(s)).toBe('95% CI 1.04–1.16');
    expect(canSayFaster(s)).toBe(true);
    // the old one-decimal text would have been "1.0× faster (95% CI 1.0–1.2)"
    const tight = { ratio: 1.006, lo: 1.003, hi: 1.009, significant: true };
    expect(speedupCiText(tight)).toBe('95% CI 1.003–1.009');
    expect(ratioText(tight)).toBe('1.006×');
    const tighter = { ratio: 1.0004, lo: 1.0002, hi: 1.0007, significant: true };
    expect(speedupCiText(tighter)).toBe('95% CI 1.0002–1.0007');
  });
  it('never rounds a lower bound up or an upper bound down, at any number of decimals', () => {
    expect(speedupCiText({ ratio: 1.02, lo: 0.976, hi: 1.081 })).toBe('95% CI 0.97–1.09');
    expect(speedupCiText({ ratio: 4.29, lo: 3.95, hi: 4.61 })).toBe('95% CI 3.9–4.7');
    expect(ratioText({ ratio: 4.29, lo: 3.95, hi: 4.61 })).toBe('4.2×');
    for (let i = 0; i < 2000; i++) {
      const lo = 0.5 + Math.random() * 3;
      const hi = lo + Math.random() * 2;
      const ratio = lo + (hi - lo) * Math.random();
      const s = { ratio, lo, hi, significant: lo > 1 };
      const m = /95% CI ([0-9.]+)–([0-9.]+)/.exec(speedupCiText(s))!;
      expect(Number(m[1])).toBeLessThanOrEqual(lo + 1e-9);
      expect(Number(m[2])).toBeGreaterThanOrEqual(hi - 1e-9);
      expect(Number(ratioText(s).slice(0, -1))).toBeLessThanOrEqual(ratio + 1e-9);
      if (canSayFaster(s)) expect(Number(m[1])).toBeGreaterThan(1);
    }
  });
  it('never says faster with a lower bound at or below 1', () => {
    expect(canSayFaster({ ratio: 1.05, lo: 1.0, hi: 1.1, significant: true })).toBe(false);
    expect(canSayFaster({ ratio: 1.05, lo: 0.99, hi: 1.1, significant: true })).toBe(false);
    expect(canSayFaster({ ratio: 1.05, lo: 1.0000000001, hi: 1.1, significant: true })).toBe(false); // prints as 1 even at 6 decimals
    expect(canSayFaster({ ratio: 3, lo: 2, hi: 4, significant: false })).toBe(false);
    expect(speedupDecimals({ ratio: 3, lo: 2, hi: 4 }, true)).toBe(1);
    expect(speedupDecimals({ ratio: 1.4, lo: 1.3, hi: 1.5 }, true)).toBe(2);
  });
  it('values and outcomes are exact', () => {
    expect(valText([1, 'a', null, { k: true }])).toBe('[1, "a", null, { k: true }]');
    expect(outcomeVerb({ tag: 'throw', message: 'empty' })).toBe('throws "empty"');
    expect(msText(1234)).toBe('1,234 ms');
    expect(msText(180_000)).toBe('3.0 min');
  });
});

describe('provenance', () => {
  it('derives the stamp from the toolchain snapshot (reduce never sets stamp)', () => {
    const st = stampOf({ stamp: null, toolchain: FIXTURE_TOOLCHAIN })!;
    expect(st.date).toBe('2026-10-04');
    expect(st.modelId).toBe('gpt-6-luna');
    const rows = Object.fromEntries(provenanceRows(st).map((r) => [r.label, r.value]));
    expect(rows['Lean']).toBe('4.34.0');
    expect(rows['Z3']).toBe('5.2.0 (WASM)');
    expect(rows['Codex CLI']).toBe('0.159.2');
  });
  it('says when nothing is recorded', () => {
    expect(provenanceRows(null)[0]!.value).toContain('not recorded');
  });
});

describe('keys', () => {
  it('maps arrows and brackets, ignores typing and modifiers', () => {
    expect(bindingOf({ key: 'ArrowLeft' })).toBe('prev');
    expect(bindingOf({ key: ']' })).toBe('next');
    expect(bindingOf({ key: 'a', metaKey: true })).toBeNull();
    expect(bindingOf({ key: 'a', target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(isTypingTarget({ tagName: 'INPUT', type: 'range' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
  });
});

describe('store and stepper navigation', () => {
  it('reaches the current and completed stages only', () => {
    const store = createStore();
    const ev = FIXTURES.catch!.events;
    store.reset(ev.slice(0, 4)); // through spec.proposed: stage agree
    expect(store.state.value.stage).toBe('agree');
    expect(store.reachable('translate')).toBe(true);
    expect(store.reachable('prove')).toBe(false);
    store.move(1);
    expect(store.shown.value).toBe('agree');
    store.move(-1);
    expect(store.shown.value).toBe('translate');
    store.move(-1);
    store.move(-1);
    expect(store.shown.value).toBe('select');
    for (const e of ev.slice(4)) store.push(e);
    expect(store.state.value.stage).toBe('deliver');
    expect(store.shown.value).toBe('select'); // the user's choice is kept while events arrive
    store.go(null);
    expect(store.shown.value).toBe('deliver');
  });
});

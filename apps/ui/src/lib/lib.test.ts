import { describe, expect, it } from 'vitest';
import { tokenize, toLines } from './highlight';
import { bindingOf, isTypingTarget } from './keys';
import { ceil1, floor1, msText, outcomeVerb, valText } from './format';
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

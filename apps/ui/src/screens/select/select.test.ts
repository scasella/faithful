// @vitest-environment happy-dom
/** Select: typeahead ranking (pure) and the keyboard-only flow in a DOM: '/', type, ↓, Enter; 'p', paste, Mod+Enter. */
import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { renderToString } from 'preact-render-to-string';
import type { FileEntry } from '../../actions';
import { ReplayAdapter } from '../../adapters/replay';
import { AppContext } from '../../app/AppContext';
import { catchFixture, FIB_SOURCE } from '../../fixtures/catch';
import { visibleText } from '../../test/text';
import { fakeAdapter, storeWith } from '../agree/testkit';
import { matchFunctions, pastedName } from './match';
import { CLI_FORM, SelectScreen } from './SelectScreen';

const FILES: FileEntry[] = [
  { path: 'src/strings.ts', functions: [{ name: 'slugify', line: 3, hasJsDoc: false }, { name: 'fibber', line: 20, hasJsDoc: false }] },
  {
    path: 'src/math/fib.ts',
    functions: [
      { name: 'fib', line: 2, hasJsDoc: true },
      { name: 'fibonacciTable', line: 9, hasJsDoc: false },
    ],
  },
  { path: 'src/math/gcd.ts', functions: [{ name: 'gcd', line: 1, hasJsDoc: false }] },
];

describe('matchFunctions', () => {
  it('empty query lists everything in repository order (path, then line)', () => {
    const { hits, total } = matchFunctions(FILES, '');
    expect(total).toBe(5);
    expect(hits.map((x) => `${x.path}:${x.name}`)).toEqual(['src/math/fib.ts:fib', 'src/math/fib.ts:fibonacciTable', 'src/math/gcd.ts:gcd', 'src/strings.ts:slugify', 'src/strings.ts:fibber']);
  });
  it('exact name first, then prefixes, then substrings', () => {
    expect(matchFunctions(FILES, 'fib').hits.map((x) => x.name)).toEqual(['fib', 'fibonacciTable', 'fibber']);
    expect(matchFunctions(FILES, 'FIB').hits[0]!.name).toBe('fib');
    expect(matchFunctions(FILES, 'table').hits.map((x) => x.name)).toEqual(['fibonacciTable']);
  });
  it('matches file paths, "file fn" pairs and subsequences', () => {
    expect(matchFunctions(FILES, 'gcd.ts').hits.map((x) => x.name)).toEqual(['gcd']);
    expect(matchFunctions(FILES, 'strings slug').hits.map((x) => x.name)).toEqual(['slugify']);
    const sub = matchFunctions(FILES, 'fbt').hits;
    expect(sub.map((x) => x.name)).toEqual(['fibonacciTable']);
    expect(sub[0]!.nameHits).toEqual([0, 2, 9]);
    expect(matchFunctions(FILES, 'zzz').hits).toEqual([]);
  });
  it('limits the list but reports the total', () => {
    const many: FileEntry[] = [{ path: 'a.ts', functions: Array.from({ length: 80 }, (_, i) => ({ name: `f${i}`, line: i + 1, hasJsDoc: false })) }];
    const r = matchFunctions(many, 'f');
    expect(r.hits.length).toBe(50);
    expect(r.total).toBe(80);
  });
  it('reads the name a pasted function declares', () => {
    expect(pastedName(FIB_SOURCE)).toBe('fib');
    expect(pastedName('function g(a: number) { return a; }')).toBe('g');
    expect(pastedName('const h = 1;')).toBeNull();
  });
});

describe('Select screen', () => {
  let root: HTMLElement;
  afterEach(() => {
    render(null, root);
    root.remove();
  });
  const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
  const keyOn = (el: EventTarget, key: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init })));

  async function mount() {
    root = document.createElement('div');
    document.body.append(root);
    const store = storeWith([]);
    const adapter = fakeAdapter(FILES);
    act(() => render(h(AppContext.Provider, { value: { store, adapter } }, h(SelectScreen, {})), root));
    await flush();
    return { store, adapter };
  }

  it('keyboard only: type, ↓, Enter opens the chosen function', async () => {
    const { adapter } = await mount();
    expect(adapter.listFiles).toHaveBeenCalledTimes(1);
    const input = root.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    keyOn(window, '/');
    expect(document.activeElement).toBe(input);
    act(() => {
      input.value = 'fib';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect([...root.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['fibsrc/math/fib.ts:2', 'fibonacciTablesrc/math/fib.ts:9', 'fibbersrc/strings.ts:20']);
    keyOn(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('sel-opt-1');
    keyOn(input, 'Enter');
    expect(adapter.openFunction).toHaveBeenCalledWith('src/math/fib.ts', 'fibonacciTable');
    expect(root.textContent).toContain('Opening fibonacciTable in src/math/fib.ts.');
  });

  it("'p' switches to pasting; Ctrl+Enter in the field uses the paste", async () => {
    const { adapter } = await mount();
    keyOn(window, 'p');
    const area = root.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(area).toBeTruthy();
    act(() => {
      area.value = FIB_SOURCE;
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    keyOn(area, 'Enter', { ctrlKey: true });
    expect(adapter.pasteFunction).toHaveBeenCalledWith(FIB_SOURCE, undefined);
  });

  it('shows the CLI form as one line and nothing about later stages', async () => {
    await mount();
    expect(root.textContent).toContain(`Command-line form: ${CLI_FORM}`);
    expect(root.textContent).not.toMatch(/Proved|spec|Lean/);
  });

  it('a failed listing is reported inline, and pasting stays available', async () => {
    root = document.createElement('div');
    document.body.append(root);
    const adapter = fakeAdapter();
    adapter.listFiles.mockRejectedValueOnce(new Error('HTTP 404'));
    act(() => render(h(AppContext.Provider, { value: { store: storeWith([]), adapter } }, h(SelectScreen, {})), root));
    // the adapter first answers "unknown" to the ranked ask (a fixture), then the page lists the files itself
    for (let i = 0; i < 4; i++) await flush();
    expect(root.textContent).toContain("Could not list the repository's functions: HTTP 404.");
    expect(root.textContent).toContain('Paste a function instead');
  });

  it('in a replay it shows the chosen function and never lists files', () => {
    const store = storeWith(catchFixture.events);
    const adapter = new ReplayAdapter(catchFixture.events, { label: '', fixture: true });
    const text = visibleText(renderToString(h(AppContext.Provider, { value: { store, adapter } }, h(SelectScreen, {}))));
    expect(text).toContain('This session is about fib in src/math/fib.ts.');
    expect(text).toContain('Replay: choosing a function is not available');
  });
});

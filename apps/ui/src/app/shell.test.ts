// @vitest-environment happy-dom
/** The shell's job line (busy indicator, persistent failure) and the Toolchain panel (key T). */
import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { renderToString } from 'preact-render-to-string';
import { Shell } from './App';
import { ReplayAdapter } from '../adapters/replay';
import { FIXTURES } from '../fixtures';
import { createStore } from '../store';
import { fakeAdapter } from '../screens/agree/testkit';
import { visibleText } from '../test/text';
import { indexOf } from '../screens/prove/testutil';

const EV = FIXTURES.catch!.events;

describe('job line', () => {
  it('a running job shows a calm indicator with its name and disables the actions that would start another', () => {
    const store = createStore();
    store.reset([...EV.slice(0, indexOf('translate.done') + 1), { seq: 99, t: 0, event: { kind: 'job.started', job: 'spec-proposal' } }]);
    const html = renderToString(h(Shell, { store, adapter: fakeAdapter() }));
    const text = visibleText(html);
    expect(text).toContain('Asking the model for a spec, then checking it against the Lean model…');
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-keyshortcuts="n"[^>]*title="Waiting: Asking the model for a spec/);
  });

  it('a failed job stays visible, inline, until the next job starts', () => {
    const store = createStore();
    store.reset(EV.slice(0, indexOf('translate.done') + 1));
    store.push({ kind: 'job.started', job: 'spec-proposal' });
    store.push({ kind: 'job.failed', job: 'spec-proposal', message: 'codex: not logged in' });
    const shown = () => visibleText(renderToString(h(Shell, { store, adapter: fakeAdapter() })));
    expect(shown()).toContain('Asking the model for a spec, then checking it against the Lean model failed. codex: not logged in');
    store.push({ kind: 'throw.choice', choice: 'precondition' }); // unrelated events do not clear it
    store.go('select');
    expect(shown()).toContain('codex: not logged in');
    store.push({ kind: 'job.started', job: 'spec-proposal' });
    expect(shown()).not.toContain('codex: not logged in');
  });

  it('Stop stays available while the optimize job runs (the server accepts it then)', () => {
    const store = createStore();
    store.reset([...EV.slice(0, indexOf('candidate.proposed') + 1), { seq: 99, t: 0, event: { kind: 'job.started', job: 'optimize' } }]);
    const html = renderToString(h(Shell, { store, adapter: fakeAdapter() }));
    const stop = html.match(/<button[^>]*aria-keyshortcuts="x"[^>]*>/)![0];
    expect(stop).not.toMatch(/disabled/);
  });
});

describe('Toolchain panel', () => {
  let root: HTMLElement;
  afterEach(() => {
    render(null, root);
    root.remove();
  });
  const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

  it("'T' opens it non-modally with the server's checks, Esc closes it", async () => {
    root = document.createElement('div');
    document.body.append(root);
    const store = createStore();
    store.reset(EV);
    const adapter = fakeAdapter();
    adapter.doctor.mockResolvedValue([
      { id: 'lean', label: 'Lean', status: 'fail', detail: 'not found', fix: 'faithful setup' },
      { id: 'z3', label: 'Z3', status: 'ok', detail: 'z3-solver 5.2.0 (WASM)' },
    ]);
    act(() => render(h(Shell, { store, adapter }), root));
    key('T');
    await act(async () => {});
    const panel = root.querySelector('aside.tc')!;
    expect(panel).toBeTruthy();
    expect(root.querySelector('dialog[open]')).toBeNull();
    expect(panel.textContent).toContain('Missing');
    expect(panel.textContent).toContain('faithful setup');
    expect(panel.textContent).toContain('the proof tiers need Lean');
    key('Escape');
    expect(root.querySelector('aside.tc')).toBeNull();
  });

  it('in a replay there is no server: it says so and shows the recorded toolchain', async () => {
    root = document.createElement('div');
    document.body.append(root);
    const store = createStore();
    store.reset(EV);
    const replay = new ReplayAdapter(EV, { label: 'x', fixture: true });
    act(() => render(h(Shell, { store, adapter: replay, replay }), root));
    key('T');
    await act(async () => {});
    const panel = root.querySelector('aside.tc')!;
    expect(panel.textContent).toContain('this is a replay, nothing runs');
    expect(panel.textContent).toContain('4.34.0');
  });
});

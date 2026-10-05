// @vitest-environment happy-dom
/** The ruling flow by keyboard alone, in a DOM: s / f, then x / c, the server's carve-out menu by number, j / k, a. */
import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { SessionEvent } from '@faithful/session';
import type { Precondition } from '@faithful/translate';
import { AppContext } from '../../app/AppContext';
import { catchFixture } from '../../fixtures/catch';
import { AgreeScreen } from './AgreeScreen';
import { fakeAdapter, storeWith } from './testkit';

const EV = catchFixture.events;
const at = (kind: SessionEvent['kind'], nth = 0) => EV.map((e, i) => [e, i] as const).filter(([e]) => e.event.kind === kind)[nth]![1];
const firstRuling = EV[at('ruling.made')]!.event as Extract<SessionEvent, { kind: 'ruling.made' }>;
const CARVE = (firstRuling.ruling as { carveOut: Precondition }).carveOut;

let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
});

function mount(events = EV.slice(0, at('challenge.run') + 1)) {
  root = document.createElement('div');
  document.body.append(root);
  const store = storeWith(events);
  const adapter = fakeAdapter();
  act(() => render(h(AppContext.Provider, { value: { store, adapter } }, h(AgreeScreen, {})), root));
  return { store, adapter };
}
const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
const text = () => root.textContent ?? '';

describe('Agree by keyboard', () => {
  it("'s' rules the active challenge: the spec is wrong", () => {
    const { adapter } = mount();
    key('s');
    expect(adapter.rule).toHaveBeenCalledWith('ch-1', { ruling: 'spec-wrong' });
  });

  it("'f' then 'x': my function is wrong, I will fix it", () => {
    const { adapter } = mount();
    key('f');
    expect(text()).toContain('Your function is wrong on this input.');
    key('x');
    expect(adapter.rule).toHaveBeenCalledWith('ch-1', { ruling: 'function-wrong', then: 'fix-original' });
  });

  it("'f', 'c', then a number: carves out the class the server offered; Esc steps back", async () => {
    const { adapter } = mount();
    key('f');
    key('c');
    expect(adapter.carveOptions).toHaveBeenCalledWith('ch-1');
    await act(async () => {});
    expect(text()).toContain('Exclude inputs where n is negative');
    expect(text()).toContain('Exclude only the input [-1]');
    expect(root.querySelector('textarea')).toBeNull(); // no free text: nobody types a condition
    key('1');
    expect(adapter.rule).toHaveBeenCalledWith('ch-1', { ruling: 'function-wrong', then: 'carve-out', carve: { param: 0, kind: 'negative' } });
    key('Escape');
    expect(text()).toContain('Your function is wrong on this input.');
    key('Escape');
    expect(text()).toContain('Who is right on this input?');
  });

  it('a failure to fetch the carve-out menu is shown inline, and nothing is sent', async () => {
    const { adapter } = mount();
    adapter.carveOptions.mockRejectedValueOnce(new Error('unknown challenge'));
    key('f');
    key('c');
    await act(async () => {});
    expect(text()).toContain('unknown challenge');
    key('1');
    expect(adapter.rule).not.toHaveBeenCalled();
  });

  it("'j' / 'k' move between unruled challenges; the keys act on the active one only", () => {
    const { adapter } = mount();
    key('j');
    key('s');
    expect(adapter.rule).toHaveBeenCalledTimes(1);
    expect(adapter.rule).toHaveBeenCalledWith('ch-2', { ruling: 'spec-wrong' });
    key('k');
    key('s');
    expect(adapter.rule).toHaveBeenLastCalledWith('ch-1', { ruling: 'spec-wrong' });
  });

  it('a recorded carve-out stays in the band', () => {
    const { store } = mount();
    act(() => store.push(firstRuling));
    expect(root.querySelector('.carve-band')?.textContent).toContain(CARVE.words);
  });

  it('while the server runs a job, the ruling keys do nothing and the reason is on the buttons', () => {
    const { store, adapter } = mount();
    act(() => store.push({ kind: 'job.started', job: 'challenge' }));
    key('s');
    expect(adapter.rule).not.toHaveBeenCalled();
    expect(root.querySelector('button[aria-keyshortcuts="s"]')!.getAttribute('title')).toMatch(/is running/);
  });

  it("'a' does nothing while a challenge is unruled; once all are ruled it opens the only modal", () => {
    const { store } = mount();
    const dlgBefore = root.querySelector('dialog')!;
    key('a');
    expect(dlgBefore.open).toBe(false);
    act(() => {
      store.push(EV[at('ruling.made')]!);
      store.push(EV[at('challenge.run', 1)]!); // the server re-runs after a carve-out: no disagreement left
    });
    const dlg = root.querySelector('dialog')!;
    key('a');
    expect(dlg.open).toBe(true);
    expect(root.querySelectorAll('dialog').length).toBe(1);
  });
});

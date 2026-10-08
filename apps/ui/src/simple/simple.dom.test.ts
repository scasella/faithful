// @vitest-environment happy-dom
/**
 * The Simple view in a DOM, driven through the real Actions (ScriptedAdapter over the catch fixture): every step by
 * clicks, focus on the new step's heading, the server's carve-out menu, and switching to the full view and back on the
 * same store and the same connection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { ScriptedAdapter } from '../adapters/scripted';
import { FIXTURES } from '../fixtures';
import { createStore } from '../store';
import { assertClaimsExact } from '../test/text';
import { SimpleApp } from './SimpleApp';
import { Views } from './Views';
import { VIEW_COOKIE } from './viewPref';
import { DELIVERED_ID, H1_ID } from './parts';

let root: HTMLElement;
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  document.cookie = `${VIEW_COOKIE}=; Path=/; Max-Age=0`;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mount(vnode: VNode<any>) {
  root = document.createElement('div');
  document.body.append(root);
  act(() => render(vnode, root));
}
const h1 = () => document.getElementById(H1_ID)?.textContent ?? '';
const text = () => root.textContent ?? '';
const button = (label: string) => {
  const b = [...root.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim().startsWith(label));
  if (!b) throw new Error(`no button "${label}" in: ${text().slice(0, 400)}`);
  return b as HTMLButtonElement;
};
async function settle(adapter: ScriptedAdapter) {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await adapter.idle();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function click(label: string, adapter: ScriptedAdapter) {
  const b = button(label);
  expect(b.disabled, `"${label}" is disabled`).toBe(false);
  await act(async () => b.click());
  await settle(adapter);
}

describe('Simple view, driven', () => {
  it('Pick → Agree (a carve-out from the server menu) → Prove → Faster → Result → delivered, focus on each new heading', async () => {
    const fx = FIXTURES.catch!;
    const store = createStore();
    const adapter = new ScriptedAdapter(fx.events, { label: fx.title, stepMs: 0 });
    mount(h(SimpleApp, { store, adapter, fixtureTitle: fx.title }));
    await settle(adapter);
    expect(h1()).toBe('Which function should get faster?');
    const item = root.querySelector('#s-results li') as HTMLElement;
    expect(item.textContent).toContain('fib');

    await act(async () => item.click());
    await settle(adapter);
    expect(h1()).toContain('Agree on what');
    expect(document.activeElement?.id).toBe(H1_ID);

    await click('Propose a spec', adapter);
    expect(h1()).toBe('Who is right on this input?');
    expect(text()).toContain('Disagreement 1 of');
    expect(document.activeElement?.id).toBe(H1_ID); // same step, new screen: focus still lands on its heading

    await click('Carve these inputs out', adapter);
    expect(text()).toContain('Exclude inputs where n is negative');
    expect(document.activeElement?.classList.contains('s-focus')).toBe(true); // the menu's question
    expect(root.querySelector('textarea')).toBeNull(); // nobody types a condition
    await click('Exclude inputs where n is negative', adapter);
    expect(store.state.value.carveOuts).toHaveLength(1);
    expect(h1()).toBe('Agree to this spec?');
    expect(document.activeElement?.id).toBe(H1_ID);
    assertClaimsExact(text());

    await click('Agree', adapter);
    expect(store.state.value.agreement).not.toBeNull();
    expect(h1()).toContain('Prove that');
    expect(document.activeElement?.id).toBe(H1_ID);

    await click('Prove it', adapter);
    expect(store.state.value.proofs.at(-1)!.budget).toEqual({ maxAttempts: 10, minutes: 12 });
    expect(h1()).toBe('Find a faster version');

    await click('Find a faster version', adapter);
    expect(store.state.value.optimize.threshold).toEqual({ kind: 'time-budget', minutes: 10 });
    expect(h1()).toBe('Candidate 2 replaces the original');
    assertClaimsExact(text());

    await click('Get the patch', adapter);
    expect(store.state.value.delivery).not.toBeNull();
    expect(document.activeElement?.id).toBe(DELIVERED_ID); // the heading stays; focus goes to the delivered files
    expect(text()).toContain('faithful verify .faithful/fib');
    assertClaimsExact(text());
  });

  it('a refused function: "Pick another function" goes back to Pick; "Continue on the Tested tier only" starts with the default threshold', async () => {
    const fx = FIXTURES.refused!;
    const store = createStore();
    const adapter = new ScriptedAdapter(fx.events, { label: fx.title, stepMs: 0 });
    const spy = vi.spyOn(adapter, 'startTestedOnly');
    mount(h(SimpleApp, { store, adapter }));
    await settle(adapter);
    await act(async () => (root.querySelector('#s-results li') as HTMLElement).click());
    await settle(adapter);
    expect(h1()).toContain('only tested');
    await click('Continue on the Tested tier only', adapter);
    expect(spy).toHaveBeenCalledWith({ kind: 'time-budget', minutes: 10 }, { specials: false });
    // this fixture records no Tested-only run: the refusal shows inline, in one sentence, under the buttons
    expect(root.querySelector('.s-actions .s-err')?.textContent).toContain('No Tested-only optimization is recorded');
    await click('Pick another function', adapter);
    expect(h1()).toBe('Which function should get faster?');
    expect(text()).toContain('Step 1 · Pick'); // not the old session's step count
    expect(root.querySelector('.s-actions .s-err')).toBeNull(); // nor its failure
  });

  it('the carve menu: "Back" returns focus to the question; more than nine classes are counted', async () => {
    const fx = FIXTURES.catch!;
    const store = createStore();
    const adapter = new ScriptedAdapter(fx.events, { label: fx.title, stepMs: 0 });
    const opts = await adapter.carveOptions('x').catch(() => []);
    const one = opts[0] ?? { cls: { kind: 'negative', param: 'n' }, excluded: 'inputs where n is negative' };
    vi.spyOn(adapter, 'carveOptions').mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Array.from({ length: 12 }, (_, i) => ({ ...one, cls: { ...(one as any).cls, param: `p${i}` }, excluded: `class ${i + 1}` })) as any,
    );
    mount(h(SimpleApp, { store, adapter }));
    await settle(adapter);
    await act(async () => (root.querySelector('#s-results li') as HTMLElement).click());
    await settle(adapter);
    await click('Propose a spec', adapter);
    await click('Carve these inputs out', adapter);
    expect(root.querySelectorAll('.s-options li')).toHaveLength(9);
    expect(text()).toContain('The server offered 12 classes; the first nine are listed');
    await click('Back', adapter);
    await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(document.activeElement?.id).toBe(H1_ID);
  });
});

describe('switching views', () => {
  it('Simple ⇄ full on one store and one connection; the choice goes into the session cookie', async () => {
    const fx = FIXTURES.catch!;
    const store = createStore();
    const adapter = new ScriptedAdapter(fx.events, { label: fx.title, stepMs: 0 });
    const connect = vi.spyOn(adapter, 'connect');
    mount(h(Views, { store, adapter, initial: 'simple', persist: true }));
    await settle(adapter);
    await act(async () => (root.querySelector('#s-results li') as HTMLElement).click());
    await settle(adapter);
    const events = store.events.value.length;
    expect(events).toBeGreaterThan(0);

    await act(async () => button('Full view').click());
    expect(root.querySelector('.stepper')).not.toBeNull();
    expect(document.cookie).toContain(`${VIEW_COOKIE}=full`);
    await act(async () => button('Simple view').click());
    expect(h1()).toContain('Agree on what');
    expect(document.cookie).toContain(`${VIEW_COOKIE}=simple`);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(store.events.value.length).toBe(events); // nothing re-sent, nothing reset
  });

  it('without persist (dev fixtures) the cookie is left alone', async () => {
    const fx = FIXTURES.catch!;
    const store = createStore();
    const adapter = new ScriptedAdapter(fx.events, { label: fx.title, stepMs: 0 });
    mount(h(Views, { store, adapter, initial: 'full' }));
    await act(async () => button('Simple view').click());
    expect(document.cookie).not.toContain(VIEW_COOKIE);
    expect(h1()).toBe('Which function should get faster?');
  });
});

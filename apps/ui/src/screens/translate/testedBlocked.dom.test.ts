// @vitest-environment happy-dom
/**
 * A refused function the Tested tier can never run (its file imports another module): both views ask the server's
 * preflight (`testedCheck`) on the refused screen and, when it says no, show its reason and only the way to another
 * function. Unknown (null) or ok keeps the usual offer. A Tested run that failed loading the original offers no retry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, render, type FunctionComponent } from 'preact';
import { act } from 'preact/test-utils';
import type { StampedEvent } from '@faithful/session';
import { TIER_LABEL } from '@faithful/core/tiers';
import type { TestedCheck } from '../../actions';
import { AppContext } from '../../app/AppContext';
import { refusedFixture } from '../../fixtures/refused';
import { testedFixture } from '../../fixtures/tested';
import { SimpleShell } from '../../simple/SimpleApp';
import { assertClaimsExact } from '../../test/text';
import { fakeAdapter, storeWith } from '../agree/testkit';
import { JobBar } from '../../app/JobBar';
import { TranslateScreen } from './TranslateScreen';

const REASON =
  'average cannot run on its own: its file imports another module (line 7, column 1). The Tested tier runs the function in an isolated sandbox, so it needs a self-contained file.';
const LOAD_FAILED = 'calibration: the original did not load: line 7, column 1: import declarations are not allowed: the function must be self-contained';

let root: HTMLElement;
afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

async function mount(kind: 'simple' | 'full', events: StampedEvent[], check: TestedCheck) {
  const store = storeWith(events);
  const adapter = fakeAdapter();
  adapter.testedCheck.mockImplementation(async () => check);
  root = document.createElement('div');
  document.body.append(root);
  const tree =
    kind === 'simple'
      ? h(SimpleShell, { store, adapter, onFull: () => undefined })
      : h(AppContext.Provider, { value: { store, adapter } }, h('div', {}, h(JobBar, {}), h(TranslateScreen as FunctionComponent, {})));
  await act(async () => render(tree, root));
  for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return { store, adapter };
}
const text = () => root.textContent ?? '';
const buttons = () => [...root.querySelectorAll('button')].map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim());
const upTo = (kind: string) => testedFixture.events.slice(0, testedFixture.events.findIndex((e) => e.event.kind === kind) + 1);
const loadFailed = (): StampedEvent[] => [...upTo('tested.started'), { seq: 99, t: 0, event: { kind: 'job.failed', job: 'tested', message: LOAD_FAILED } }];

describe('Simple view: refused, and the Tested tier cannot run it', () => {
  it('blocked: the reason in one sentence, no Tested button, only "Pick another function"', async () => {
    const { adapter } = await mount('simple', refusedFixture.events, { ok: false, reason: REASON });
    expect(adapter.testedCheck).toHaveBeenCalled();
    expect(text()).toContain(REASON);
    expect(buttons().some((b) => b.startsWith(`Continue on the ${TIER_LABEL.tested} tier only`))).toBe(false);
    expect(buttons()).toContain('Pick another function');
    assertClaimsExact(text());
  });

  it.each([['ok', { ok: true } as TestedCheck], ['unknown', null]])('%s: the Tested tier is offered as before', async (_, check) => {
    await mount('simple', refusedFixture.events, check);
    expect(buttons().some((b) => b.startsWith(`Continue on the ${TIER_LABEL.tested} tier only`))).toBe(true);
    expect(text()).not.toContain('cannot run on its own');
  });

  it('a run that failed loading the original: the plain reason, no "Try again"', async () => {
    await mount('simple', loadFailed(), null);
    expect(text()).toContain(REASON);
    expect(buttons()).not.toContain('Try again');
    expect(buttons()).toContain('Pick another function');
    expect(text()).not.toContain('calibration');
  });

  it('a failed retry the server preflight now refuses: no "Try again" either', async () => {
    const evs: StampedEvent[] = [...upTo('tested.started'), { seq: 99, t: 0, event: { kind: 'job.failed', job: 'tested', message: REASON } }];
    await mount('simple', evs, { ok: false, reason: REASON });
    expect(buttons()).not.toContain('Try again');
    expect(text()).toContain(REASON);
  });
});

describe('Full view: refused, and the Tested tier cannot run it', () => {
  it('blocked: the reason, no "Optimize with the Tested tier only", and "Choose another function" goes back to Select', async () => {
    const { store } = await mount('full', refusedFixture.events, { ok: false, reason: REASON });
    expect(text()).toContain(REASON);
    expect(buttons().some((b) => b.startsWith(`Optimize with the ${TIER_LABEL.tested} tier only`))).toBe(false);
    expect(text()).not.toContain('Time budget');
    const back = [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Choose another function'))!;
    expect(back).toBeTruthy();
    const go = vi.spyOn(store, 'go');
    await act(async () => back.click());
    expect(go).toHaveBeenCalledWith('select');
    assertClaimsExact(text());
  });

  it('unknown: the offer stays', async () => {
    await mount('full', refusedFixture.events, null);
    expect(buttons().some((b) => b.startsWith(`Optimize with the ${TIER_LABEL.tested} tier only`))).toBe(true);
  });

  it('a run that failed loading the original: the plain reason and "Choose another function"', async () => {
    await mount('full', loadFailed(), null);
    expect(text()).toContain(REASON);
    expect(text()).not.toContain('calibration'); // the job line says it in plain words too
    expect(buttons().some((b) => b.startsWith('Choose another function'))).toBe(true);
  });
});

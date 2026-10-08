/** Test-only helpers shared by the Select, Translate and Agree tests: a live-looking adapter that records calls, and renderers. */
import { vi } from 'vitest';
import { h, type FunctionComponent } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { SessionEvent, StampedEvent } from '@faithful/session';
import type { Adapter, FileEntry } from '../../actions';
import { AppContext } from '../../app/AppContext';
import { createStore, type Store } from '../../store';

export type FakeAdapter = Adapter & { [K in keyof Adapter]: Adapter[K] extends (...a: infer A) => infer R ? ReturnType<typeof vi.fn<(...a: A) => R>> : Adapter[K] };

/** Not read-only, so every control is live; each Actions method is a vi.fn that resolves at once. */
export function fakeAdapter(files: FileEntry[] = []): FakeAdapter {
  const ok = () => vi.fn(async () => {});
  return {
    readOnly: false,
    label: 'test',
    connect: vi.fn(() => () => {}),
    listFiles: vi.fn(async () => files),
    functionStatus: vi.fn(async () => null),
    pickFunctions: vi.fn(async () => null),
    scanStatus: vi.fn(async () => null),
    startScan: vi.fn(async () => null),
    openFunction: ok(),
    pasteFunction: ok(),
    chooseThrow: ok(),
    proposeSpec: ok(),
    reviseSpec: ok(),
    rerunChallenge: ok(),
    rule: ok(),
    carveOptions: vi.fn(async () => [
      { cls: { param: 0, kind: 'negative' }, excluded: 'inputs where n is negative' },
      { cls: { param: 0, kind: 'equals' }, excluded: 'inputs where n is exactly -1' },
      { cls: { param: -1, kind: 'exact-input' }, excluded: 'only the input [-1]' },
    ]),
    doctor: vi.fn(async () => []),
    agree: ok(),
    proveOriginal: ok(),
    startOptimize: ok(),
    startTestedOnly: ok(),
    testedCheck: vi.fn(async () => null),
    acceptFasterNotProved: ok(),
    stopOptimize: ok(),
    deliver: ok(),
  } as unknown as FakeAdapter;
}

export function storeWith(events: Array<StampedEvent | SessionEvent>): Store {
  const store = createStore();
  store.reset(events);
  return store;
}

export function renderScreen(Screen: FunctionComponent, store: Store, adapter: Adapter): string {
  return renderToString(h(AppContext.Provider, { value: { store, adapter } }, h(Screen, {})));
}

/** The opening tag of the first <button> whose text starts with `label`. */
export function buttonTag(html: string, label: string): string {
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  for (const m of html.matchAll(re)) {
    const text = m[2]!.replace(/<[^>]+>/g, '').trim();
    if (text.startsWith(label)) return `<button${m[1]}>`;
  }
  throw new Error(`no button starting with ${JSON.stringify(label)}`);
}

export const isDisabled = (tag: string) => /\sdisabled(?:=""|\s|>)/.test(tag);

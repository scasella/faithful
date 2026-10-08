/**
 * The app in one of its two views, Simple (src/simple/) or full (app/App.tsx Shell), over ONE connection: the adapter is
 * attached to the store once (Attached) and switching swaps only the view inside it, so nothing is re-sent or reset.
 * Used by main.tsx for the live UI and for dev fixtures (?mock=…&view=simple).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Adapter } from '../actions';
import type { ReplayAdapter } from '../adapters/replay';
import { Shell } from '../app/App';
import { attach, type Store } from '../store';
import { H1_ID } from './parts';
import { SimpleShell } from './SimpleApp';
import { writeView, type View } from './viewPref';

/** Attaches the adapter to the store once, for as long as it is mounted, whichever view is shown inside it. */
export function Attached({ store, adapter, onAttached, children }: { store: Store; adapter: Adapter; onAttached?(): void; children: ComponentChildren }) {
  useEffect(() => {
    const off = attach(store, adapter);
    onAttached?.();
    return off;
  }, [store, adapter]);
  return <>{children}</>;
}

/**
 * The app in one of its two views. Switching swaps the view only: the store and the adapter's connection stay as they
 * are (nothing is re-sent, nothing is reset). `persist`: remember the choice in the session cookie (live UI only).
 * After a switch, focus goes to the new view: the Simple view's heading, or the full view's "Simple view" button.
 */
export function Views(props: {
  store: Store;
  adapter: Adapter;
  replay?: ReplayAdapter;
  fixtureTitle?: string;
  onAttached?(): void;
  onAbout?(): void;
  initial: View;
  persist?: boolean;
}) {
  const { store, adapter, replay, fixtureTitle, onAttached, onAbout, initial, persist } = props;
  const [view, setView] = useState<View>(initial);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scrollTo(0, 0);
    const t = setTimeout(() => {
      const target = view === 'simple' ? document.getElementById(H1_ID) : (document.querySelector('[data-simple]') as HTMLElement | null);
      target?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [view]);
  const go = (v: View) => {
    if (persist) writeView(v);
    setView(v);
  };
  return (
    <Attached store={store} adapter={adapter} onAttached={onAttached}>
      {view === 'simple' ? (
        <SimpleShell store={store} adapter={adapter} fixtureTitle={fixtureTitle} onFull={() => go('full')} />
      ) : (
        <Shell store={store} adapter={adapter} replay={replay} fixtureTitle={fixtureTitle} onAbout={onAbout} onSimple={() => go('simple')} />
      )}
    </Attached>
  );
}

/** Test helpers for the Prove / Optimize / Deliver screen tests: render the shell at a stage over a list of events. */
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { SessionEvent, StageName, StampedEvent } from '@faithful/session';
import { Shell } from '../../app/App';
import { ReplayAdapter } from '../../adapters/replay';
import type { Adapter } from '../../actions';
import { FIXTURES } from '../../fixtures';
import { createStore } from '../../store';
import { visibleText } from '../../test/text';

export const CATCH = FIXTURES.catch!.events;

export function indexOf(kind: SessionEvent['kind'], from = 0): number {
  const i = CATCH.findIndex((e, j) => j >= from && e.event.kind === kind);
  if (i < 0) throw new Error(`no ${kind} in fixture`);
  return i;
}

export function restamp(events: Array<StampedEvent | SessionEvent>): StampedEvent[] {
  let t = 0;
  return events.map((e, seq) => {
    if ('event' in e) {
      t = Math.max(t, e.t);
      return { ...e, seq };
    }
    t += 100;
    return { seq, t, event: e };
  });
}

export function render(events: Array<StampedEvent | SessionEvent>, stage?: StageName, adapter?: Adapter): { html: string; text: string } {
  const evs = restamp(events);
  const store = createStore();
  store.reset(evs);
  if (stage) store.go(stage);
  const a = adapter ?? new ReplayAdapter(evs, { label: 'test', fixture: true });
  const html = renderToString(h(Shell, { store, adapter: a }));
  return { html, text: visibleText(html) };
}

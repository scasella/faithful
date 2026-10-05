import type { StampedEvent } from '@faithful/session';

/**
 * Dev-mode `&at=` for fixtures: a number of events to deliver, or `<event kind>[:<k>]` meaning "right after the k-th
 * event of that kind" (1-based). Null when absent or not found, so the caller falls back to the default.
 */
export function seekTarget(events: StampedEvent[], at: string | null): number | null {
  if (at === null || at === '') return null;
  if (/^\d+$/.test(at)) return Math.min(Number(at), events.length);
  const [kind, kth] = at.split(':');
  const want = kth ? Number(kth) : 1;
  let seen = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.event.kind === kind && ++seen === want) return i + 1;
  }
  return null;
}

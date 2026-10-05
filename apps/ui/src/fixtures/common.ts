/**
 * DEVELOPMENT FIXTURES, NOT RECORDINGS.
 *
 * Everything under src/fixtures/ is hand-authored for UI development and tests. No tool ran to produce these events;
 * the numbers are realistic-looking but invented. The UI shows FIXTURE_NOTICE whenever a fixture is loaded, and the
 * showcase must never load these as evidence.
 */
import type { SessionEvent, StampedEvent } from '@faithful/session';
import type { ToolchainSnapshot } from '@faithful/core';
import type { Span } from '@faithful/translate';

export const FIXTURE_NOTICE = 'Development fixture, not a recording';
export const FIXTURE_DETAIL = 'Hand-authored events for UI development. No tool ran; every number on this page is invented.';

export interface Fixture {
  name: string;
  title: string;
  /** Always true: the type exists so a recording can never be mistaken for one of these. */
  fixture: true;
  events: StampedEvent[];
}

export const FIXTURE_TOOLCHAIN: ToolchainSnapshot = {
  capturedAt: '2026-10-04T14:02:11.000Z',
  node: 'v25.8.1',
  platform: 'darwin-arm64',
  codex: { version: '0.159.2', model: 'gpt-6-luna', effort: 'low' },
  lean: { version: '4.34.0', toolchain: 'leanprover/lean4:v4.34.0', mathlibCommit: '5ed2965256430c3649e86755f9576b54eca72435' },
  z3: { kind: 'wasm', version: '5.2.0' },
};

/** Build a stamped list from [delay-ms-since-previous, event] pairs. */
export function timeline(steps: Array<[number, SessionEvent]>): StampedEvent[] {
  let t = 0;
  return steps.map(([dt, event], seq) => {
    t += dt;
    return { seq, t, event };
  });
}

/** Exact span of `needle` in `text` (UTF-16 offsets, 1-based line/column). Throws if absent, so fixtures stay honest. */
export function spanOf(text: string, needle: string): Span {
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`fixture: ${JSON.stringify(needle)} not in source`);
  const before = text.slice(0, start);
  const line = before.split('\n').length;
  const column = start - before.lastIndexOf('\n');
  return { start, end: start + needle.length, line, column };
}

/** ISO time at `ms` after the fixture snapshot. */
export function at(ms: number): string {
  return new Date(Date.parse(FIXTURE_TOOLCHAIN.capturedAt) + ms).toISOString();
}

/** Deterministic fake hex digest (fixtures only). */
export function fakeHash(seed: string): string {
  let h = 2166136261;
  let out = '';
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ r, 16777619) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

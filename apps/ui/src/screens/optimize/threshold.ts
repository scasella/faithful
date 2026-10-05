/**
 * The threshold choice made before optimizing: when does the loop stop? Pure state + validation, no rendering.
 *   time-budget  (default)  stop after M minutes
 *   speedup                 stop when the current best is faster than the original by at least the target: the server
 *                           checks the lower bound of the speedup's 95% CI against it, on the declared distribution
 *   asymptotic              not implemented by the server in this build: shown, disabled, with that note
 *
 * The declared distribution is not typed by the user: the server calibrates it from the original when optimizing starts
 * and shows it (with its sizes) beside the baseline benchmark. The `distribution` field of the speedup threshold is
 * therefore sent as a fixed descriptor; the server does not read it.
 */
import type { Threshold } from '@faithful/session';

export type ThresholdKind = Threshold['kind'];

export const ASYMPTOTIC_NOTE = 'not available in this build';

export const THRESHOLD_KINDS: Array<{ kind: ThresholdKind; key: string; title: string; words: string; available: boolean }> = [
  { kind: 'time-budget', key: '1', title: 'Time budget', words: 'Stop after a fixed number of minutes and keep the best candidate found.', available: true },
  {
    kind: 'speedup',
    key: '2',
    title: 'Target speedup',
    words:
      'Stop once the current best is at least this many times faster than the original: the lower end of its 95% CI must reach the target, on the declared distribution.',
    available: true,
  },
  { kind: 'asymptotic', key: '3', title: 'Asymptotic', words: `Compare how the cost grows over a sweep of input sizes: ${ASYMPTOTIC_NOTE}.`, available: false },
];

/** What the speedup threshold's distribution field carries: the server calibrates and declares the real one. */
export const DECLARED_BY_SERVER = 'the declared distribution (calibrated from the original when optimizing starts)';

export interface ThresholdDraft {
  kind: ThresholdKind;
  minutes: string;
  target: string;
}

export const DEFAULT_DRAFT: ThresholdDraft = { kind: 'time-budget', minutes: '10', target: '2' };

export type DraftAction = { type: 'kind'; kind: ThresholdKind } | { type: 'field'; field: 'minutes' | 'target'; value: string } | { type: 'reset' };

export function draftReducer(d: ThresholdDraft, a: DraftAction): ThresholdDraft {
  switch (a.type) {
    case 'kind':
      // An unavailable kind cannot be selected.
      return THRESHOLD_KINDS.find((k) => k.kind === a.kind)?.available ? { ...d, kind: a.kind } : d;
    case 'field':
      return { ...d, [a.field]: a.value };
    case 'reset':
      return DEFAULT_DRAFT;
  }
}

export type ThresholdParse = { ok: true; threshold: Threshold } | { ok: false; error: string };

/** Validate the fields of the selected kind only; the others keep what the user typed. */
export function parseThreshold(d: ThresholdDraft): ThresholdParse {
  switch (d.kind) {
    case 'time-budget': {
      const m = Number(d.minutes.trim());
      if (!d.minutes.trim() || !Number.isFinite(m) || m <= 0 || m > 24 * 60) return { ok: false, error: 'Minutes must be a number above 0 and at most 1,440.' };
      return { ok: true, threshold: { kind: 'time-budget', minutes: m } };
    }
    case 'speedup': {
      const t = Number(d.target.trim());
      if (!d.target.trim() || !Number.isFinite(t) || t <= 1) return { ok: false, error: 'The target speedup must be a number above 1 (for example 2 for twice as fast).' };
      return { ok: true, threshold: { kind: 'speedup', target: t, distribution: DECLARED_BY_SERVER } };
    }
    case 'asymptotic':
      return { ok: false, error: `The asymptotic threshold is ${ASYMPTOTIC_NOTE}.` };
  }
}

/** One plain sentence for a chosen threshold (shown on the Optimize screen once started). */
export function thresholdWords(t: Threshold): string {
  switch (t.kind) {
    case 'time-budget':
      return `Time budget: ${t.minutes} minute${t.minutes === 1 ? '' : 's'}.`;
    case 'speedup':
      return `Target: ${t.target}× faster than the original (lower end of the 95% CI), on the declared distribution.`;
    case 'asymptotic':
      return `Asymptotic: sizes ${t.sizes.join(', ')} (${ASYMPTOTIC_NOTE}).`;
  }
}

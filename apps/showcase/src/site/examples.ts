/**
 * HAND-WRITTEN EXAMPLE CANDIDATES for the live checks, keyed by function name. They are written for this page by hand
 * (not by a model and not taken from any recording) so a visitor can watch the live checks pass one candidate and
 * catch another. The page labels them as such wherever they appear. A recording's own candidates (from its
 * `candidate.proposed` events) are listed separately and labelled as recorded.
 */
export interface Example {
  key: string;
  title: string;
  /** What the author meant it to show (it is the live run, not this text, that decides the result). */
  intent: string;
  source: string;
}

export const EXAMPLES: Record<string, Example[]> = {
  clamp: [
    {
      key: 'clamp-ternary',
      title: 'Two comparisons instead of Math.min/Math.max',
      intent: 'meant to behave exactly like the original',
      source: `export function clamp(value: number, lo: number, hi: number): number {
  if (lo > hi) {
    throw new Error("clamp: lower bound exceeds upper bound");
  }
  return value < lo ? lo : value > hi ? hi : value;
}
`,
    },
    {
      key: 'clamp-no-lower',
      title: 'Forgets the lower bound',
      intent: 'meant to be wrong: values below lo come back unchanged',
      source: `export function clamp(value: number, lo: number, hi: number): number {
  if (lo > hi) {
    throw new Error("clamp: lower bound exceeds upper bound");
  }
  return value > hi ? hi : value;
}
`,
    },
  ],
};

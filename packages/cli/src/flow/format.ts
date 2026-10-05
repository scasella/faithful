/** Speedup text that never rounds up a claim: estimate and lower bound round DOWN, upper bound rounds UP, 2 decimals. */
const down = (x: number, d: number): string => (Math.floor(x * 10 ** d) / 10 ** d).toFixed(d);
const up = (x: number, d: number): string => (Math.ceil(x * 10 ** d) / 10 ** d).toFixed(d);

export function speedupText(s: { ratio: number; lo: number; hi: number }): string {
  const d = s.ratio >= 100 ? 0 : s.ratio >= 10 ? 1 : 2;
  return `${down(s.ratio, d)}× (95% CI ${down(s.lo, d)}–${up(s.hi, d)})`;
}

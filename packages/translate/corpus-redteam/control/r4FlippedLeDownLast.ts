// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[7],[10],[-3]]
// @redteam-note round 4: `0 <= i` (flipped) with i -= 2 as the last body statement after an early break
export function f(n: number): number { let i = n; let s = 0; while (0 <= i) { if (s > 20) break; s += i; i -= 2; } return s * 100 + i; }

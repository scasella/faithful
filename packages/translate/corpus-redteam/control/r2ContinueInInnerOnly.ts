// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[4],[-2]]
// @redteam-note round 2: counter updated by a top-level body statement; the only `continue` belongs to an inner loop
export function f(n: number): number { let s = 0; let i = 0; while (i < n) { for (let j = 0; j < 3; j++) { if (j === 1) continue; s += j * i; } i = i + 1; } return s; }

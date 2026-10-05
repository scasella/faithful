// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0,0],[3,2],[4,5]]
// @redteam-note round 4: outer while counter after an inner for loop with its own continue
export function f(n: number, m: number): number { let i = 0; let s = 0; while (i < n) { for (let j = 0; j < m; j++) { if (j === 1) continue; s += j; } i += 1; } return s; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[10,3],[0,0],[5,7],[-2,1]]
// @redteam-note round 4: Option via `undefined` returns from inside a counting-down while
export function f(n: number, k: number): number | undefined { let i = n; while (i > 0) { if (i === k) return undefined; if (i * 3 === k) return i; i -= 1; } return undefined; }

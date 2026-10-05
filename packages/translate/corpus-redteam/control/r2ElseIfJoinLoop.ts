// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,0],[3,1],[3,2],[0,1],[-1,1]]
export function f(n: number, k: number): number { let s = 0; if (k === 0) { s = 1; } else if (k === 1) { for (let i = 0; i < n; i++) { s += 2; } } else { s = 3; } return s; }

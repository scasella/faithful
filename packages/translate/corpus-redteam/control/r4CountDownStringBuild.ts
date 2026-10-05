// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[5,2],[0,1],[3,3],[-2,1]]
// @redteam-note round 4: count-down for with continue after a string append
export function f(n: number, k: number): string { let s = ""; for (let i = n; i > 0; i -= 1) { if (i % k === 0) { s = s + "[" + i + "]"; continue; } s += i; } return s; }

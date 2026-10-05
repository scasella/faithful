// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[10]]
// @redteam-note round 3: counter updated by a top-level body statement, then a conditional throw after the update
export function f(n: number): number { let i = 0; let s = 0; while (i < n) { s += i; i += 2; if (s > 10) throw new Error("big"); } return s; }

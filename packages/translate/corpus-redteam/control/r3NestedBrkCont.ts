// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3],[0],[5]]
// @redteam-note round 3: outer continue + inner break/continue, both with incrementors
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { if (i === 1) continue; for (let j = 0; j < n; j++) { if (j > i) break; if (j === 0) continue; s = s * 3 + j; } s = s + 100; } return s; }

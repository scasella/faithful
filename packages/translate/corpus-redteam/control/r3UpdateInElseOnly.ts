// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note round 3: counter updated in both branches of an if (two sites): refused; completeness
export function f(n: number): number { let i = 0; while (i < n) { if (i === 2) { i += 2; } else { i++; } } return i; }

// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note round 4: guard `b >= 0` with b = n - 1 through a const chain: the finder only reads literal bounds on the parameter itself; refused (documented completeness limit)
export function f(n: number): number { const a = n; const b = a - 1; const c = b >= 0; if (c) { const d = b; return 1 + f(d); } return 0; }

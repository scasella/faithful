// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: TDZ inside a loop body (read of a shadowed const before its declaration): refused via TS2448
export function f(n: number): number { let x = n; for (let i = 0; i < 2; i++) { x = x + 1; const x = 5; } return x; }

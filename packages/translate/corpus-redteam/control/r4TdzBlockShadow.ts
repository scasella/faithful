// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: TDZ: assignment to a block-shadowed let before its declaration (ReferenceError in JS): refused via TS2448
export function f(n: number): number { let x = n; { x = 2; let x = 3; return x; } }

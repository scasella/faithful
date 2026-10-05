// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: const declaration as a for body without a block (SyntaxError): refused via TS1156
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) const y = i; return s; }

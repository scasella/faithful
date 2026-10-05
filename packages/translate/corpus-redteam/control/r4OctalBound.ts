// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: legacy octal literal as a loop bound (strict SyntaxError; BigInt('010') would read 10): refused via TS1121
export function f(n: number): number { let s = 0; for (let i = 0; i < 010; i++) s += n; return s; }

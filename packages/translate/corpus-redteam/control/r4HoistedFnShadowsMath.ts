// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note round 4: hoisted function declaration named Math: refused
export function f(n: number): number { return Math.floor(n / 2); function Math() {} }

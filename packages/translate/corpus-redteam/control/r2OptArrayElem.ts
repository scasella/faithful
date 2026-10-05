// @redteam area=control status=held
// @redteam-expect refuse:unsupported-type
export function f(n: number): (number | null)[] { return [n, null]; }

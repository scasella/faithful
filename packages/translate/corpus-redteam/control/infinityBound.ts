// @redteam area=control status=held
// @redteam-expect refuse:float
// @redteam-note refused: Infinity is not an integer
export function f(n: number): number { for (let i = 0; i < Infinity; i++) { if (i > n) return i; } return -1; }

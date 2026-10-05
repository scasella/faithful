// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[[1,2,0,9],[11,0]]],[[]],[[[1],[2]]]]
export function f(m: number[][]): number { let total = 0; for (const row of m) { let k = 0; for (const v of row) { if (v === 0) break; k = k + v; } if (k > 10) return total * 7 + k; total = total + k; } return total; }

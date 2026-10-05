// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[-1],[0],[1],[2]]
// @redteam-note round 2: boolean | null: false and null must stay distinct
export function f(n: number): boolean | null { if (n < 0) return null; if (n === 0) return false; return n % 2 === 0; }

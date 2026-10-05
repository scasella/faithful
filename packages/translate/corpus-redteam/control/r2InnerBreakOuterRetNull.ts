// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[[1,0,-1]]],[[[1,-1]]],[[[0],[2,-3]]],[[[],[4]]]]
export function f(xs: number[][]): number | null { for (const row of xs) { for (const x of row) { if (x === 0) break; if (x < 0) return null; } } return xs.length; }

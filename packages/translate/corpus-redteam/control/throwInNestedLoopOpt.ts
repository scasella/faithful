// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[[1,2],[3,0]]],[[[1,-1]]],[[]],[[[1]]]]
export function f(xs: number[][]): number | null { for (const row of xs) { for (let j = 0; j < row.length; j++) { if (row[j] < 0) throw new Error("neg"); if (row[j] === 0) return j; } } return null; }

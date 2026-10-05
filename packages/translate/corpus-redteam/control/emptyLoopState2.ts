// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2]],[[]]]
export function f(xs: number[]): number { for (const x of xs) { const y = x + 1; } let k = 0; while (k < 3) { k = k + 1; } return xs.length + k; }

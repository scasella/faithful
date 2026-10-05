// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2]],[[]]]
export function f(xs: number[]): number { for (const x of xs) { } return xs.length; }

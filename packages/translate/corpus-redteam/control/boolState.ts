// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[2,4,1,6]],[[]]]
export function f(xs: number[]): boolean { let flag = false; for (const x of xs) { if (x > 0) { if (x % 2 === 0) { flag = !flag; } } } return flag; }

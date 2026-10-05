// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,-3,4]],[[]],[[5]]]
export function f(xs: number[]): number { let s = 0; let last = -1; for (const x of xs) { if (x < 0) { last = x; s = s + 100; break; } s = s + x; } return s * 1000 + last; }

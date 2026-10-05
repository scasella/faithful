// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[0]],[[1,2]],[[0,1,2]],[[]]]
export function f(xs: number[]): boolean | null { let seen = false; for (const x of xs) { if (x === 0) { seen = true; } } if (!seen) return null; return xs.length > 2; }

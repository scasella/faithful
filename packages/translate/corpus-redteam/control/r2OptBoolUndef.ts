// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[11]],[[-11]],[[1,2,3]],[[0,-20,20]]]
// @redteam-note round 2: boolean | undefined, falling off the end after a for...of with returns
export function f(xs: number[]): boolean | undefined { for (const x of xs) { if (x > 10) return true; if (x < -10) return false; } }

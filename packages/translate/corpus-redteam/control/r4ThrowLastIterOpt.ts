// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],3],[[1,2],3],[[],0],[[7],7]]
// @redteam-note round 4: throw on the last iteration of a for...of in an Option function
export function f(xs: number[], k: number): number | null { let i = 0; for (const x of xs) { i++; if (i === xs.length && x === k) throw new Error("last"); if (x === k) return i; } return null; }

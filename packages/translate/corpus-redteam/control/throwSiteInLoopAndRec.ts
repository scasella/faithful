// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],5],[[1,2,3],2],[[],-1],[[9,9,9,9],2]]
export function f(xs: number[], d: number): number { if (d < 0) throw new Error("depth"); for (const x of xs) { if (x === d) throw new Error("hit"); } if (xs.length === 0) return d; return f(xs.slice(1), d - 1); }

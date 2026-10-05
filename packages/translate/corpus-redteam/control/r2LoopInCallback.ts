// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[0,1,5]],[[-3,10]]]
// @redteam-note round 2: a counting loop inside a map callback, capturing the callback parameter as its bound
export function f(xs: number[]): number[] { return xs.map((x) => { let s = 0; for (let i = 0; i < x; i++) { s += i; } return s; }); }

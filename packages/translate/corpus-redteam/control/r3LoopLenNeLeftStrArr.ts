// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,2,3]]]
// @redteam-note round 3: `0 !== xs.length` loop over string[] building a string
export function f(xs: string[]): string { let r = ""; while (0 !== xs.length) { r = r + xs[0]; xs = xs.slice(1); } return r; }

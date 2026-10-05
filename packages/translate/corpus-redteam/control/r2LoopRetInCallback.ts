// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[0,1,5,81,82,200]],[[-3]]]
// @redteam-note round 2: return from a loop inside a callback returns from the callback, not the function
export function f(xs: number[]): number[] { return xs.map((x) => { for (let i = 0; i < 10; i++) { if (i * i >= x) return i; } return -1; }); }

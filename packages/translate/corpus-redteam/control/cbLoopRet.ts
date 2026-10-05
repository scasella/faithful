// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[0,3,7,-1]],[[]]]
export function f(xs: number[]): number[] { return xs.map((x) => { for (let i = 0; i < 5; i++) { if (i === x) return i * 10; } return -1; }); }

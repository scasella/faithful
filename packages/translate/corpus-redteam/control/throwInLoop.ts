// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2]],[[1,-1]],[[]]]
export function f(xs: number[]): number { let s = 0; for (const x of xs) { if (x < 0) throw new Error("neg"); s = s + x; } return s; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3]],[[1,-2,3]],[[]],[[4]]]
// @redteam-note round 3: option return + throw inside for...of
export function f(xs: number[]): number | null { for (const x of xs) { if (x < 0) throw new Error("neg"); if (x > 3) return x; } return null; }

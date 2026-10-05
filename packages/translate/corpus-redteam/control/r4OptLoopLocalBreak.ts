// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],2],[[5,-1,7],0],[[],1],[[4,4],9]]
// @redteam-note round 4: Option return: a body-local const returned on one path, break to the fall-off none on another
export function f(xs: number[], k: number): number | null { for (const x of xs) { const y = x * 2; if (y === k * 2) return y; if (x < 0) break; } return null; }

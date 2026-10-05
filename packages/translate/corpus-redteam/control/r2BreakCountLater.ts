// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[]],[[1,0,2]],[[1,2]],[[0]]]
export function f(xs: number[]): number { let i = 0; let found = -1; for (const x of xs) { if (x === 0) { found = i; break; } i++; } return found * 100 + i; }

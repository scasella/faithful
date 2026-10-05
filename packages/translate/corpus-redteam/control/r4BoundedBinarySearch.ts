// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,3,5,7,9],7],[[1,3,5,7,9],4],[[],1],[[2],2],[[1,1,1],1]]
// @redteam-note round 4: binary search under a bounded step counter, Option return, unreachable throw
export function f(xs: number[], t: number): number | null { let lo = 0; let hi = xs.length - 1; for (let step = 0; step < 64; step++) { if (lo > hi) return null; const mid = Math.floor((lo + hi) / 2); if (xs[mid] === t) return mid; if (xs[mid] < t) { lo = mid + 1; } else { hi = mid - 1; } } throw new Error("unreachable"); }

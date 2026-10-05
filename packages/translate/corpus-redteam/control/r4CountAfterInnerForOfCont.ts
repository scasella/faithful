// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3],5],[[],0],[[0],2]]
// @redteam-note round 4: counter updated top-level after an inner for...of with its own continue (hasOwnContinue must stop at the inner loop)
export function f(xs: number[], n: number): number { let s = 0; let i = 0; while (i < n) { for (const x of xs) { if (x === 2) continue; s += x; } i++; } return s; }

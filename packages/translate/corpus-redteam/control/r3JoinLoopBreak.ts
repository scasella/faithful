// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,0,4],true],[[1,2,0,4],false],[[],true]]
// @redteam-note round 3: if-join whose then-branch is a for...of with break that modifies the joined variable
export function f(xs: number[], c: boolean): number { let s = 7; if (c) { for (const x of xs) { if (x === 0) break; s = s + x; } } else { s = -1; } return s; }

// @redteam area=arithmetic status=held expect=refuse code=no-termination-measure
export function ceilHalvingLoop(a: number): number { let n = a; let c = 0; while (n > 1) { n = Math.ceil(n / 2); c++; } return c; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[-3]]
// @redteam-note round 4: non-null assertions on the counter in condition and incrementor (unparen strips `!` in the measure finder)
export function f(n: number): number { let s = 0; for (let i = 0; i! < n!; i!++) { s += i!; } return s; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[10],[499],[500],[800]]
// @redteam-note round 4: unused self-call result: depth bound still applies (500 inside, 500 outside)
export function f(n: number): number { if (n > 0) { const t = f(n - 1); } return n; }

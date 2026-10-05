// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[94906267,true],[94906267,false],[2,true]]
// @redteam-note round 4: unused ternary whose taken branch overflows
export function f(n: number, b: boolean): number { const t = b ? n * n : 0; return n; }

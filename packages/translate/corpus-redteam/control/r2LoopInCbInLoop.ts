// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[],3],[[1,2,3],2],[[4],0],[[5,-2],-1]]
export function f(xs: number[], n: number): number { let t = 0; for (let k = 0; k < n; k++) { t += xs.map((x) => { let s = 0; for (let i = 0; i < x; i++) { s += i * x; } return s; }).reduce((a, b) => a + b, 0); } return t; }

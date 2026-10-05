// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2],3],[[],2],[[5],0]]
export function f(xs: number[], n: number): number[] { let ys: number[] = []; for (let i = 0; i < n; i++) { const k = i; ys = ys.concat(xs.map((x) => x + k)); } return ys; }

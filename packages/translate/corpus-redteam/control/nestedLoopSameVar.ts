// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
export function f(n: number): number { let c = 0; let i = 0; while (i < n) { for (let j = 0; j < 2; j++) { c = c + 1; } i = i + 1; } return c; }

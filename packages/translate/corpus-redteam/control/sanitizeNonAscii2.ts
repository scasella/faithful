// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1,2]]
export function f(é: number, ê: number): number { return é * 10 + ê; }

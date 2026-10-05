// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1]]
export function f(n: number): number { return n; throw new Error("never"); }

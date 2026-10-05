// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[9]]
// @redteam-note round 3: boolean | undefined via a ternary with an undefined branch
export function f(n: number): boolean | undefined { return n > 0 ? n > 5 : undefined; }

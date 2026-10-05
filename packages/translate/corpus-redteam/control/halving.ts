// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[7],[-8],[9007199254740992]]
export function f(n: number): number { let c = 0; while (n > 0) { n = Math.floor(n / 2); c = c + 1; } return c; }

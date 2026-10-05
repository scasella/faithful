// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[2],[3],[1024],[-8],[9007199254740992]]
export function f(n: number): number { if (n >= 2) return 1 + f(Math.floor(n / 2)); return 0; }

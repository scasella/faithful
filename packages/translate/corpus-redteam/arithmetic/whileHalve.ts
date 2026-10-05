// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[1],[-1],[2],[-3],[7],[9007199254740992],[-9007199254740992],[9007199254740991],[-9007199254740991],[9007199254740988],[-9007199254740988],[20],[19],[18]]
export function whileHalve(a: number): number { let n = a; let c = 0; while (n > 0) { n = Math.floor(n / 2); c = c + 1; } return c * 1000000 + n; }

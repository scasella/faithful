// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[1],[-1],[10],[-10],[99],[9007199254740992],[-9007199254740992],[9007199254740991],[-9007199254740991],[1234567890123456]]
export function recHalve(n: number): number { if (n < 1) { return n % 3; } return 1 + recHalve(Math.floor(n / 2)); }

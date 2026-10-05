// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[1],[-1],[10],[-10],[99],[9007199254740992],[-9007199254740992],[9007199254740991],[-9007199254740991],[1234567890123456]]
export function digitSumNeg(a: number): number { let n = Math.abs(a); let s = 0; while (n > 0) { s += n % 10; n = Math.floor(n / 10); } return a < 0 ? -s : s; }

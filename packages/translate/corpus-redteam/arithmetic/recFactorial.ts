// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[1],[5],[17],[18],[19],[20],[-5]]
export function recFactorial(n: number): number { if (n <= 1) { return 1; } return n * recFactorial(n - 1); }

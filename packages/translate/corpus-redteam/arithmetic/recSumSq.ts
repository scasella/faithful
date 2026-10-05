// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[3],[200],[3000],[9000],[9800],[10000]]
export function recSumSq(n: number): number { return n <= 0 ? 0 : n * n * n * n + recSumSq(n - 1); }

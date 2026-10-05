// @redteam area=strings status=held
// @inputs [[0],[3],[-2],[498],[499],[500]]
export function f(n: number): string { if (n <= 0) return ""; return f(n - 1) + n + (n % 2 === 0); }

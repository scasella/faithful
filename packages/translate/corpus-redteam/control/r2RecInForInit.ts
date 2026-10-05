// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[2],[5],[-3],[499],[500]]
// @redteam-note round 2: self-call in a for-initializer (evaluated once, outside the loop function); depth check must cover it
export function f(n: number): number { if (n <= 0) return 0; let s = 0; for (let i = f(n - 1); i < n; i++) { s += i; } return s; }

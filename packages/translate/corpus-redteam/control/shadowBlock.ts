// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[-4]]
export function f(n: number): number { let x = n; { let x = 5; x = x + 1; } if (n > 0) { const x = 100; return x; } return x; }

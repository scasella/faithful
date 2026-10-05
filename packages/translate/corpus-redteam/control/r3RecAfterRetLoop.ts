// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-2],[7]]
// @redteam-note round 3: self-call after a loop with return (measure walk through matchFlow)
export function f(n: number): number { for (let i = 0; i < n; i++) { if (i === 5) return -1; } if (n <= 0) return 0; return 1 + f(n - 1); }

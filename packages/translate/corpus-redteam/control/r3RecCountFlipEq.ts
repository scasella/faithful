// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[-1]]
// @redteam-note round 3: `n < 0` throws, `0 === n` returns (flipped), then n - 1
export function f(n: number): number { if (n < 0) throw new Error("neg"); if (0 === n) return 0; return n + f(n - 1); }

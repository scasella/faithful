// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[2],[5],[-1]]
// @redteam-note round 4: throw precondition + nested ternary Option return with self-call passthrough
export function f(n: number): number | null { if (n < 0) throw new Error("neg"); return n === 0 ? null : n === 2 ? 2 : f(n - 1); }

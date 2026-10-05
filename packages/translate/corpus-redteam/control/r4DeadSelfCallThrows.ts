// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[5],[2],[3],[0]]
// @redteam-note round 4: unused self-call result whose callee throws: the throw must propagate
export function f(n: number): number { if (n === 3) throw new Error("three"); if (n > 0) { const t = f(n - 1); } return n; }

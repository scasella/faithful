// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[5],[-1]]
// @redteam-note round 3: `return (c ? n : null) satisfies number | null`
export function f(n: number): number | null { return (n > 0 ? n : null) satisfies number | null; }

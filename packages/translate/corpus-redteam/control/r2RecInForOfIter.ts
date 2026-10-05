// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[3],[6],[-1],[200]]
// @redteam-note round 2: self-call as the for...of iterable (evaluated once, before the loop)
export function f(n: number): number[] { if (n <= 0) return []; let acc: number[] = [n]; for (const x of f(n - 1)) { acc = acc.concat([x * 2]); } return acc; }

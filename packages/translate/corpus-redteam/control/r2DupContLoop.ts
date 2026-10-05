// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[-1,3],[0,3],[101,3],[50,0],[-5,-2]]
// @redteam-note round 2: a loop in a duplicated continuation (memoized loop function, called with different SSA states)
export function f(n: number, m: number): number { let s = 0; if (n < 0) { s = 5; } else if (n > 100) { return -1; } for (let i = 0; i < m; i++) { s += i; } return s; }

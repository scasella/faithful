// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[2],[7],[-5],[499],[500]]
// @redteam-note round 2: || with a self-call on the right is lowered to an if; guard from the negated left operand
export function f(n: number): boolean { return n <= 0 || !f(n - 1); }

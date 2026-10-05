// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3]]
// @redteam-note round 4: unreachable non-terminating self-call after return: never lowered, no claim about it
export function f(n: number): number { return n + 1; return f(n + 1); }

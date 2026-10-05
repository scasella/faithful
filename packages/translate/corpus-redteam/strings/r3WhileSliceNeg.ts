// @redteam area=strings status=held expect=refuse code=no-termination-measure
export function f(s: string): number { let c = 0; while (s !== "") { s = s.slice(-1); c = c + 1; } return c; }

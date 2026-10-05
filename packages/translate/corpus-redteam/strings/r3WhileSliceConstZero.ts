// @redteam area=strings status=held expect=refuse code=no-termination-measure
const K = 0;
export function f(s: string): number { let c = 0; while (s.length > 0) { s = s.slice(K); c = c + 1; } return c; }

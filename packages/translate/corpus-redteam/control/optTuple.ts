// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3],[0]]
export function f(n: number): [number, number] | null { if (n > 0) return [n, n]; return null; }

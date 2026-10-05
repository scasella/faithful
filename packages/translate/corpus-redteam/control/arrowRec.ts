// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[-2]]
export const f = (n: number): number => (n <= 0 ? 0 : n + f(n - 1));

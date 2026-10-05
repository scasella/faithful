// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[2],[5]]
export function f(n: number): string | undefined { for (let i = 0; i < n; i++) { if (i === 3) return "three"; } return undefined; }

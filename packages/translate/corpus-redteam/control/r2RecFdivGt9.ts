// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[9],[10],[-15],[987654321],[9007199254740992]]
export function f(n: number): number { if (n > 9) return (n % 10) + f(Math.floor(n / 10)); return n; }

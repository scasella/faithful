// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1],[64],[100],[14],[9007199254740992],[-5]]
export function f(n: number): number { let c = 0; while (n > 1) { if (n % 7 === 0) throw new Error("seven"); if (n % 5 === 0) break; c = c + 1; n = Math.floor(n / 2); } return c * 1000 + n; }

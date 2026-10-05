// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[9007199254740991],[9007199254740989],[9007199254740980],[9007199254740972]]
export function f(a: number): number { let c = 0; for (let i = a; i < 9007199254740992; i += 5) { c = c + 1; if (c < 3) continue; return c; } return c; }

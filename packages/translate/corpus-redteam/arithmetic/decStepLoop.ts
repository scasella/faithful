// @redteam area=arithmetic status=held expect=ok
// @inputs [[-9007199254740989,-9007199254740992],[-9007199254740990,-9007199254740992],[-9007199254740991,-9007199254740992],[5,0],[9007199254740992,9007199254740987]]
export function decStepLoop(a: number, b: number): number { let c = 0; for (let i = a; i > b; i -= 2) { c = c + 1; if (c > 10) { return -1; } } return c; }

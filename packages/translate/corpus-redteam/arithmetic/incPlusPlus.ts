// @redteam area=arithmetic status=held expect=ok
// @inputs [[9007199254740990,9007199254740992],[9007199254740992,9007199254740992],[9007199254740991,9007199254740992],[0,3],[-9007199254740992,-9007199254740992]]
export function incPlusPlus(a: number, b: number): number { let c = 0; for (let i = a; i <= b; i++) { c = c + 1; if (c > 10) { return -1; } } return c; }

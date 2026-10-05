// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[1],[-1],[2],[-3],[7],[9007199254740992],[-9007199254740992],[9007199254740991],[-9007199254740991],[9007199254740988],[-9007199254740988],[20],[19],[18]]
export function throwThenRange(a: number): number { if (a > 10) { throw new Error("big"); } return a * a * a * a * a * a; }

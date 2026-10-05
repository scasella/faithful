// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[1],[-1],[2],[-3],[7],[9007199254740992],[-9007199254740992],[9007199254740991],[-9007199254740991],[9007199254740988],[-9007199254740988],[20],[19],[18]]
// a local named Infinity shadows the global
export function infLocal(a: number): number { const Infinity = 3; return a + Infinity; }

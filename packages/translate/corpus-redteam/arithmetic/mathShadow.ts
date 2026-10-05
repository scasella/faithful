// @redteam area=arithmetic status=held expect=ok
// @inputs [[0],[1],[-1],[2],[-3],[7],[9007199254740992],[-9007199254740992],[9007199254740991],[-9007199254740991],[9007199254740988],[-9007199254740988],[20],[19],[18]]
// a local named Math shadows the global (Math.floor here is a record field)
export function mathShadow(a: number): number { const Math = { floor: 1 }; return a + Math.floor; }

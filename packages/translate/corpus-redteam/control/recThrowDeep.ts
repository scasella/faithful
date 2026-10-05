// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3,1],[60,1],[2,9007199254740992],[5,9007199254740992]]
export function f(n: number, acc: number): number { if (n < 0) throw new Error("neg"); if (n === 0) return acc; return f(n - 1, acc * 2); }

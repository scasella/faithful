// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[{"match":1,"end":2,"fun":"a","mk":3,"toJson":true}]]
type P = { match: number; end: number; fun: string; mk: number; toJson: boolean };
export function f(p: P): P { let q = p; for (let i = 0; i < 2; i++) { q = { match: q.match + 1, end: q.end, fun: q.fun + "x", mk: q.mk * 2, toJson: !q.toJson }; } return q; }

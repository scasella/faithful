// @redteam area=arithmetic status=held expect=ok round=2
// int-bound on numbers inside an array of records and an array field of a record
// @inputs [[[{"k":1}],{"ys":[2,3]}],[[],{"ys":[]}]]
// @tags ["ok","ok"]
// @excluded [[[{"k":1.5}],{"ys":[]}],[[],{"ys":[9007199254740994]}],[[{"k":-9007199254740994}],{"ys":[]}]]
export function nestedRecArrBound(xs: { k: number }[], r: { ys: number[] }): number {
  return xs.length + r.ys.length;
}

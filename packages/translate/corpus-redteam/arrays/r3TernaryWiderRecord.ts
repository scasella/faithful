// @redteam area=arrays status=held
// @redteam note=conditional mixing a W and an N record (TS types it N)
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[{"a":1},{"a":2,"b":3},true],[{"a":1},{"a":2,"b":3},false]]
type W = { a: number; b: number };
type N = { a: number };
export function ternRec(n: N, w: W, c: boolean): N[] {
  const r = c ? w : n;
  return [r];
}

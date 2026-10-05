// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[{"a":1,"b":2}]]
export function tkey(r: { a: number; b: number }): number {
  return r[`a`] * 10 + r["b"];
}

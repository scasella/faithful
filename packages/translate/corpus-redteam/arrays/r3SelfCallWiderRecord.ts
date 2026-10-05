// @redteam area=arrays status=held
// @redteam note=width subtyping: a W value passed to an N-typed parameter of a self-call
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[{"a":1,"b":2},1],[{"a":1,"b":2},0]]
type W = { a: number; b: number };
type N = { a: number };
export function wid(r: N, n: number, w: W): N {
  if (n <= 0) return r;
  return wid(w, n - 1, w);
}

// @redteam area=arrays status=held
// @redteam note=width subtyping: reassigning an N-typed let with a W value
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[{"a":2,"b":3},{"a":1}]]
type W = { a: number; b: number };
type N = { a: number };
export function letRec(w: W, n: N): N {
  let r: N = n;
  r = w;
  return r;
}

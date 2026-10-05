// @redteam area=arrays status=held
// @redteam note=width subtyping: a W record placed in an N[] literal (JS keeps the extra field)
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[{"a":2,"b":3}]]
type W = { a: number; b: number };
type N = { a: number };
export function litRec(w: W): N[] {
  const out: N[] = [w];
  return out;
}

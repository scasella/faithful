// @redteam area=arrays status=held
// @redteam note=expression-body map callback returning a wider record than its annotated return type
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[[{"a":1,"b":2}]]]
type W = { a: number; b: number };
type N = { a: number };
export function narrow(xs: W[]): N[] {
  return xs.map((x): N => x);
}

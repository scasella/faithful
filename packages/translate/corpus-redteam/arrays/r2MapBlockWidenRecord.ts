// @redteam area=arrays status=held
// @redteam note=map callback with a block body returns a wider record than its annotated return type (TS width subtyping); JS keeps the extra field
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[{"a":1,"b":2}]]]
type W = { a: number; b: number };
type N = { a: number };
export function narrow(xs: W[]): N[] {
  return xs.map((x): N => {
    return x;
  });
}

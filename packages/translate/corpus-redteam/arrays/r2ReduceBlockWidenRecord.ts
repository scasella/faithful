// @redteam area=arrays status=held
// @redteam note=reduce callback with a block body returns an element of a wider record type as the accumulator; JS result keeps field b
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[{"a":1,"b":2},{"a":3,"b":4}]],[[]]]
type W = { a: number; b: number };
type N = { a: number };
export function lastA(xs: W[]): N {
  return xs.reduce((acc: N, x: W): N => {
    return x;
  }, { a: 0 });
}

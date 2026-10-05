// @redteam area=arrays status=held
// @redteam note=width subtyping: assigning a wider record element to an N-typed accumulator in a for...of
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[[{"a":2,"b":3}],{"a":1}]]
type W = { a: number; b: number };
type N = { a: number };
export function forWide(ws: W[], n: N): N {
  let best = n;
  for (const w of ws) {
    if (w.a > best.a) best = w;
  }
  return best;
}

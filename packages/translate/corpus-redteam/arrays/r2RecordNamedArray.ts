// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[{"n":2},{"n":1}]]]
interface Array2 { n: number }
type ToJson = { n: number };
export function f(xs: ToJson[]): ToJson[] {
  return xs.slice().sort((a, b) => a.n - b.n);
}

// @redteam area=arithmetic status=held expect=refuse code=float round=4
// xs.slice(1.5) as the shrinking step: JS truncates, the literal is not an integer
export function r4SliceFracArg(a: number[]): number {
  let xs = a;
  let c = 0;
  while (xs.length > 0) {
    xs = xs.slice(1.5);
    c++;
  }
  return c;
}

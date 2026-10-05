// @redteam area=arrays status=held
// @redteam note=named function expression `k` shadows a local const `k`
// @redteam expect=refuse code=unsupported-syntax|mutable-capture
// @redteam inputs=[[["a","b"]],[[]]]
export function nmLoc(xs: string[]): string[] {
  const k = "z";
  return xs.map(function k(x: string): string {
    return x + k;
  });
}

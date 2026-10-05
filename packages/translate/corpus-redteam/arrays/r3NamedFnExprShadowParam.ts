// @redteam area=arrays status=held
// @redteam note=named function expression `k` shadows a parameter `k`
// @redteam expect=refuse code=unsupported-syntax|mutable-capture
// @redteam inputs=[[["a","b"],"q"],[[],"q"]]
export function nmPar(xs: string[], k: string): string[] {
  return xs.filter(function k(x: string): boolean {
    return x + k !== "aq";
  });
}

// @redteam area=arrays status=held
// @redteam note=named function expression `k` shadows a module string constant `k`: inside, `x + k` appends the function source text in JS
// @redteam expect=refuse code=unsupported-syntax|mutable-capture
// @redteam inputs=[[["a","b"]],[[]]]
const k = "z";
export function nmMod(xs: string[]): string[] {
  return xs.map(function k(x: string): string {
    return x + k;
  });
}

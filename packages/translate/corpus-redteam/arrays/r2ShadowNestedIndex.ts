// @redteam area=arrays status=held
// @redteam note=callback parameters shadowing the outer parameter and each other (xs, i)
// @redteam expect=ok
// @redteam inputs=[[[[1,2],[3],[]]],[[]]]
export function sh(xs: number[][]): number[][] {
  return xs.map((xs, i) => xs.map((x, i) => x * 10 + i).concat([i]));
}

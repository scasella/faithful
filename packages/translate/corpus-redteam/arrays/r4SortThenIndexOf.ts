// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[-8,3,15,-1],-1],[[],0],[[7,14],0]]
// Round 4 (arrays): truncated % then sort then indexOf.
export function r4SortThenIndexOf(xs: number[], v: number): number {
  return xs.map((x) => x % 7).sort((a, b) => a - b).indexOf(v);
}

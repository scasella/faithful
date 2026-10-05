// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,-3,4],0],[[],0],[[5,6],10]]
// Round 4 (arrays): for...of with break, then slices at the break position.
export function r4ForOfBreakSlice(xs: number[], t: number): number[] {
  let i = 0;
  for (const x of xs) {
    if (x < t) break;
    i = i + 1;
  }
  return xs.slice(i).concat(xs.slice(0, i));
}

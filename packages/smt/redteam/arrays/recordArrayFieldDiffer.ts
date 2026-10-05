// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// A record with an array field returned: the count field computed over the wrong array.
export function original(xs: number[]): { pos: number[]; n: number } {
  const pos = xs.filter((x) => x > 0);
  return { pos: pos, n: pos.length };
}
export function candidate(xs: number[]): { pos: number[]; n: number } {
  const pos = xs.filter((x) => x > 0);
  return { pos: pos, n: xs.filter((x) => x >= 0).length };
}

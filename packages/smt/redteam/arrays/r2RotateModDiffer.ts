// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":2}
// Round 2, rotation: slice/concat accepts a negative i (counted from the end); the index loop computes (j + i) % n,
// which is negative for negative i, so the candidate leaves the model (bounds check) where the original returns.
export function original(xs: number[], i: number): number[] {
  return xs.slice(i).concat(xs.slice(0, i));
}
export function candidate(xs: number[], i: number): number[] {
  const n = xs.length;
  let out: number[] = [];
  for (let j = 0; j < n; j++) {
    out = out.concat([xs[(j + i) % n]]);
  }
  return out;
}

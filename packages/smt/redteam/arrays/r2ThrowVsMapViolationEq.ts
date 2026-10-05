// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":3}
// Round 2, status order: same as r2ThrowVsMapViolationDiffer but the candidate's map multiplies by 2^50, which never
// overflows for |x| <= 3 (3 * 2^50 < 2^53), so the throw is the first abnormal event on both sides.
export function original(xs: number[]): number {
  let s = 0;
  for (const x of xs) {
    if (x < 0) {
      throw new Error("negative");
    }
    s = s + x * 1125899906842624;
  }
  return s;
}
export function candidate(xs: number[]): number {
  const ys = xs.map((x) => x * 1125899906842624);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < 0) {
      throw new Error("negative");
    }
    s = s + ys[i];
  }
  return s;
}

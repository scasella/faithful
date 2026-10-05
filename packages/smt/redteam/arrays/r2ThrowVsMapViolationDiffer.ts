// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":3} adv=[[[-1,3]],[[3,-1]],[[2,-3]]]
// Round 2, status order across a callback. JavaScript runs the whole map (and its range checks) before the loop that
// throws; the original throws on the first negative before multiplying. On [-1, 3] the original throws, the
// candidate's map overflows (3 * 2^52 > 2^53) first: different outcomes (encode.ts callback `step` + evaluation order).
export function original(xs: number[]): number {
  let s = 0;
  for (const x of xs) {
    if (x < 0) {
      throw new Error("negative");
    }
    s = s + x * 4503599627370496;
  }
  return s;
}
export function candidate(xs: number[]): number {
  const ys = xs.map((x) => x * 4503599627370496);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < 0) {
      throw new Error("negative");
    }
    s = s + ys[i];
  }
  return s;
}

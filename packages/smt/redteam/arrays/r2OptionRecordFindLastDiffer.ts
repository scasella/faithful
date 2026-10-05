// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 2, as r2OptionRecordFindEq but the candidate reports the LAST negative (differs with two negatives).
interface Hit {
  at: number;
  rest: number[];
}
export function original(xs: number[]): Hit | null {
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < 0) {
      return { at: i, rest: xs.slice(i + 1) };
    }
  }
  return null;
}
export function candidate(xs: number[]): Hit | null {
  for (let i = xs.length - 1; i >= 0; i--) {
    if (xs[i] < 0) {
      return { at: i, rest: xs.slice(i + 1) };
    }
  }
  return null;
}

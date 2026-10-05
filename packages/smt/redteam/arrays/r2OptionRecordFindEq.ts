// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Round 2, option of a record with an array field: the first negative and what follows it, or null.
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
  const negs = xs.filter((x) => x < 0);
  if (negs.length === 0) {
    return null;
  }
  const i = xs.indexOf(negs[0]);
  return { at: i, rest: xs.filter((x, j) => j > i) };
}

// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2} adv=[[[9007199254740992,-9007199254740992,0,5,-5,1]]]
// Round 2, reduce with a tuple accumulator (min, max) vs sort and read both ends.
export function original(xs: number[]): [number, number] {
  if (xs.length === 0) {
    return [0, 0];
  }
  return xs.reduce((acc: [number, number], x) => [Math.min(acc[0], x), Math.max(acc[1], x)], [xs[0], xs[0]]);
}
export function candidate(xs: number[]): [number, number] {
  if (xs.length === 0) {
    return [0, 0];
  }
  const s = xs.slice().sort((a, b) => a - b);
  return [s[0], s[s.length - 1]];
}

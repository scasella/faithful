// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1}
// reduce with an array accumulator (capacity grows per step) against for...of.
export function original(xs: number[]): number[] {
  const init: number[] = [];
  return xs.reduce((acc, x) => acc.concat([x, x]), init);
}
export function candidate(xs: number[]): number[] {
  let out: number[] = [];
  for (const x of xs) {
    out = out.concat([x]).concat([x]);
  }
  return out;
}

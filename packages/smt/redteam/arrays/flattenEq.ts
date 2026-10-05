// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":1}
// @smt-redteam adv=[[[[1,2,3],[],[4,5]]],[[[],[],[]]],[[[9]]]]
// Flatten with reduce/concat vs for...of.
export function original(xs: number[][]): number[] {
  const init: number[] = [];
  return xs.reduce((acc, r) => acc.concat(r), init);
}
export function candidate(xs: number[][]): number[] {
  let out: number[] = [];
  for (const r of xs) {
    for (const x of r) {
      out = out.concat([x]);
    }
  }
  return out;
}

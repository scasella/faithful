// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Descending stable sort vs ascending sort reversed: equal-key records come out in opposite orders.
export function original(xs: { k: number; v: number }[]): { k: number; v: number }[] {
  return xs.slice().sort((a, b) => b.k - a.k);
}
export function candidate(xs: { k: number; v: number }[]): { k: number; v: number }[] {
  const asc = xs.slice().sort((a, b) => a.k - b.k);
  let out: { k: number; v: number }[] = [];
  for (const x of asc) {
    out = [x].concat(out);
  }
  return out;
}

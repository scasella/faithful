// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1}
// Option of a record: first record with a positive key, or null.
export function original(xs: { k: number; v: number }[]): { k: number; v: number } | null {
  for (const x of xs) {
    if (x.k > 0) {
      return x;
    }
  }
  return null;
}
export function candidate(xs: { k: number; v: number }[]): { k: number; v: number } | null {
  const ys = xs.filter((x) => x.k > 0);
  return ys.length === 0 ? null : { k: ys[0].k, v: ys[0].v };
}

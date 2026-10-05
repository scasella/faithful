// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":2}
// Round 2, slice end taken from a record field: slice(0, n) with a negative n drops elements from the end, a loop
// bounded by n returns []. Differs at n < 0 (seq.ts slice: relIndex of a symbolic end).
interface Page {
  items: number[];
  n: number;
}
export function original(p: Page): number[] {
  return p.items.slice(0, p.n);
}
export function candidate(p: Page): number[] {
  let out: number[] = [];
  for (let i = 0; i < p.n && i < p.items.length; i++) {
    out = out.concat([p.items[i]]);
  }
  return out;
}

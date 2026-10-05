// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Round 2, slice end from a record field, with the JavaScript clamp written out in the loop.
interface Page {
  items: number[];
  n: number;
}
export function original(p: Page): number[] {
  return p.items.slice(0, p.n);
}
export function candidate(p: Page): number[] {
  const end = p.n < 0 ? Math.max(p.items.length + p.n, 0) : Math.min(p.n, p.items.length);
  let out: number[] = [];
  for (let i = 0; i < end; i++) {
    out = out.concat([p.items[i]]);
  }
  return out;
}

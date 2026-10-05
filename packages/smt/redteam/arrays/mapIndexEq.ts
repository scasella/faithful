// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// mapI vs index loop.
export function original(xs: number[]): number[] {
  return xs.map((x, i) => x * i);
}
export function candidate(xs: number[]): number[] {
  let out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    out = out.concat([xs[i] * i]);
  }
  return out;
}

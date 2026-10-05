// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// Rotation by one: slice/concat against an index loop building with concat.
export function original(xs: number[]): number[] {
  return xs.slice(1).concat(xs.slice(0, 1));
}
export function candidate(xs: number[]): number[] {
  let out: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    out = out.concat([xs[i]]);
  }
  return xs.length > 0 ? out.concat([xs[0]]) : out;
}

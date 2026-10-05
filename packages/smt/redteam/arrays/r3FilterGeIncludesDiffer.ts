// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":2}
// Round 3: filter(x >= t).includes(v) vs v > t && includes(v): they differ exactly at v = t with v present.
export function original(xs: number[], t: number, v: number): boolean {
  return xs.filter((x) => x >= t).includes(v);
}
export function candidate(xs: number[], t: number, v: number): boolean {
  return v > t && xs.includes(v);
}

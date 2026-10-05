// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2} adv=[[[9007199254740992,-9007199254740992],9007199254740991,9007199254740992]]
// Round 3: filter(x > t).includes(v) equals v > t && includes(v).
export function original(xs: number[], t: number, v: number): boolean {
  return xs.filter((x) => x > t).includes(v);
}
export function candidate(xs: number[], t: number, v: number): boolean {
  return v > t && xs.includes(v);
}

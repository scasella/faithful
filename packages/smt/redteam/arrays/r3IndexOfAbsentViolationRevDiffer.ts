// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// Round 3: reversed roles: the CANDIDATE leaves the model (xs[-1]) when v is absent; that is a difference.
export function original(xs: number[], v: number): number {
  return v;
}
export function candidate(xs: number[], v: number): number {
  return xs[xs.indexOf(v)];
}

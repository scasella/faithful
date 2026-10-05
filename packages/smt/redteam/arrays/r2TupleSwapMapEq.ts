// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":2}
// Round 2, tuples: map to swapped pairs vs a loop building them.
export function original(ps: [number, string][]): [string, number][] {
  return ps.map((p) => [p[1], p[0]]);
}
export function candidate(ps: [number, string][]): [string, number][] {
  let out: [string, number][] = [];
  for (const p of ps) {
    const q: [string, number] = [p[1], p[0]];
    out = out.concat([q]);
  }
  return out;
}

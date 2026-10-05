// @smt-redteam expect=differ bounds={"array":1,"string":1,"int":2}
// Round 3: slice(1, 3) keeps i + j; the candidate's literal drops it, so indexOf(i + j) differs when i + j !== j.
export function original(i: number, j: number, xs: number[]): number {
  const t = [i, j, i + j].slice(1, 3).concat(xs);
  return t.indexOf(i + j);
}
export function candidate(i: number, j: number, xs: number[]): number {
  const t = [j].concat(xs);
  return t.indexOf(i + j);
}

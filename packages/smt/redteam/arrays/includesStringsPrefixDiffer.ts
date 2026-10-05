// @smt-redteam expect=differ bounds={"array":2,"string":2,"int":1}
// Element equality vs prefix test.
export function original(xs: string[], s: string): boolean {
  return xs.includes(s);
}
export function candidate(xs: string[], s: string): boolean {
  return xs.filter((x) => x.indexOf(s) === 0).length > 0;
}

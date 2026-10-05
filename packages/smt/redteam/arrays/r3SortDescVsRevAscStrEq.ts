// @smt-redteam expect=equal bounds={"array":3,"string":2,"int":1} adv=[[["￿","\u0000","퟿","","","￿"]]]
// Round 3: on strings, descending three-way sort equals the default (code-unit) sort reversed.
export function original(xs: string[]): string[] {
  return xs.slice().sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}
export function candidate(xs: string[]): string[] {
  const asc = xs.slice().sort();
  let out: string[] = [];
  for (const x of asc) {
    out = [x].concat(out);
  }
  return out;
}

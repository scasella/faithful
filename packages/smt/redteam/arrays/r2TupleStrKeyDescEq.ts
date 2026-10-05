// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1} chars=["a","b"]
// @smt-redteam adv=[[[["é",1],["",2],["￿",3],["퟿",4],["",5],["é",6]]]]
// Round 2, tuples sorted descending by a string key (three-way, b before a) vs the mirrored three-way spelling.
export function original(ps: [string, number][]): number[] {
  return ps
    .slice()
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map((p) => p[1]);
}
export function candidate(ps: [string, number][]): number[] {
  return ps
    .slice()
    .sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : 0))
    .map((p) => p[1]);
}

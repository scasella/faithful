// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1} chars=["a","b"]
// Round 2, sort records by a string field, two comparator spellings (a < b ... a > b vs a < b ... b < a), then
// project the payload: the stable network must give the same permutation for both.
interface E {
  name: string;
  v: number;
}
export function original(es: E[]): number[] {
  return es
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => e.v);
}
export function candidate(es: E[]): number[] {
  return es
    .slice()
    .sort((a, b) => (b.name < a.name ? 1 : a.name < b.name ? -1 : 0))
    .map((e) => e.v);
}

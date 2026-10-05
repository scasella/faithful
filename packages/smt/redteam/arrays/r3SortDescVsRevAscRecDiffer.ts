// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// Round 3: on records, ties ARE distinguishable: descending (stable) is not the reversed ascending sort.
interface E {
  k: number;
  v: number;
}
export function original(es: E[]): number[] {
  return es
    .slice()
    .sort((a, b) => b.k - a.k)
    .map((e) => e.v);
}
export function candidate(es: E[]): number[] {
  return es
    .slice()
    .sort((a, b) => a.k - b.k)
    .reduce((acc: number[], e) => [e.v].concat(acc), []);
}

// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1} chars=["a","b","`"]
// Round 2, sort by a string field vs bucketing on {"", "a", "b"}: any other name (Z3 may pick any BMP text) is dropped.
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
  const empty = es.filter((e) => e.name === "");
  const as = es.filter((e) => e.name === "a");
  const bs = es.filter((e) => e.name === "b");
  return empty.concat(as, bs).map((e) => e.v);
}

// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[{"k":2,"v":"a"},{"k":1,"v":"b"},{"k":2,"v":"c"},{"k":-1,"v":"d"}]],[[]]]
type E = { k: number; v: string };
export function topK(es: E[]): string {
  return es.filter((e) => e.k >= 0).sort((a, b) => (a.k > b.k ? -1 : a.k < b.k ? 1 : 0)).map((e) => e.v).join("");
}

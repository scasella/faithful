// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[{"k":2,"s":"a"},{"k":1,"s":"b"},{"k":2,"s":"c"},{"k":0,"s":"d"}]],[[]]]
type E = { k: number; s: string };
export function revCond(es: E[]): string[] {
  return es.slice().sort((a, b) => (b.k < a.k ? 1 : b.k > a.k ? -1 : 0)).map((e) => e.s);
}

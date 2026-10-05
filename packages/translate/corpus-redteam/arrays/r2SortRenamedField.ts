// @redteam area=arrays status=held
// @redteam note=comparator keyed on fields whose Lean projections are renamed (end -> end_, mk -> mk_)
// @redteam expect=ok
// @redteam inputs=[[[{"end":3,"mk":"a"},{"end":1,"mk":"b"},{"end":3,"mk":"c"}]]]
type R = { end: number; mk: string };
export function f(rs: R[]): string[] {
  return rs
    .slice()
    .sort((a, b) => b.end - a.end)
    .map((r) => r.mk)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

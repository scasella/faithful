// @redteam area=strings status=divergence expect=ok input=["abc"] ts=ok:3 lean=refused-no-termination-measure
// Completeness: structural recursion on s.slice(1) under the guard `s === ""` (equivalent to s.length === 0, which is
// recognized; see recReverse) is refused with no-termination-measure.
export function recStrNonEmpty(s: string): number {
  if (s === "") return 0;
  return 1 + recStrNonEmpty(s.slice(1));
}

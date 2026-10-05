// @redteam area=strings status=divergence expect=ok input=["abc"] ts=ok:3 lean=refused-no-termination-measure
// Completeness: a shrinking-string while loop guarded by `rest !== ""` (the array form `xs.length !== 0` is recognized).
export function whileNonEmptyStr(s: string): number {
  let rest = s;
  let n = 0;
  while (rest !== "") {
    n = n + rest.charCodeAt(0);
    rest = rest.slice(1);
  }
  return n;
}

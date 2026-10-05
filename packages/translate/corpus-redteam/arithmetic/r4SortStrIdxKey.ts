// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=4
// string-index comparator keys read undefined on "" (undefined < "x" is false), comparators are not instrumented: must stay refused
export function r4SortStrIdxKey(xs: string[]): string[] {
  return xs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

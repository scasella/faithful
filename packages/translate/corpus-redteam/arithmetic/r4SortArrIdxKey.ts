// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=4
// array-index comparator keys would read undefined (NaN comparator) on empty inner arrays, and comparators are not instrumented: must stay refused
export function r4SortArrIdxKey(xs: number[][]): number[][] {
  return xs.slice().sort((a, b) => a[0] - b[0]);
}

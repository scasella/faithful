// @redteam area=arrays status=held
// @redteam note=comparator a[0] - b[0] on number[][]: an empty row gives undefined/NaN (inconsistent comparator); the key reader accepts literal indices only on tuples
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[[2],[],[1],[-1]]],[[[1,2],[0]]]]
export function sortByHead(xss: number[][]): number[][] {
  return xss.slice().sort((a, b) => a[0] - b[0]);
}

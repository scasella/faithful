// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":1}
// @smt-redteam adv=[[[[1,2,3],[4]],1,0],[[[1,2,3],[]],0,2],[[[],[5,6]],1,1]]
// xs[i][j] with both indices symbolic, against slice-then-index.
export function original(xs: number[][], i: number, j: number): number {
  return xs[i][j];
}
export function candidate(xs: number[][], i: number, j: number): number {
  return xs[i].slice(j, j + 1)[0];
}

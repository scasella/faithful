// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,2],[3]],1,0],[[[1,2],[3]],1,1],[[[1,2],[]],1,0],[[[1]],0,0]]
export function cell(g: number[][], i: number, j: number): number {
  return g[i][j] + g[i].length;
}

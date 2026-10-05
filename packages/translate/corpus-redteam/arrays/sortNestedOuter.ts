// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[3,1],[1,0],[2,2],[1,9]]]]
export function byFirst(xss: [number, number][]): [number, number][] {
  return xss.concat(xss).sort((a, b) => a[0] - b[0]);
}

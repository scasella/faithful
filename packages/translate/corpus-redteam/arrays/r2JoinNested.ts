// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,-2],[],[3]]],[[]],[[[]]]]
export function jn(xss: number[][]): string {
  return xss.map((xs) => xs.join("-")).join("|");
}

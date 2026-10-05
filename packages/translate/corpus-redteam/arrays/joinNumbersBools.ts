// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[-1,0,9007199254740992,-9007199254740992],[true,false]],[[],[]],[[0],[]]]
export function j(xs: number[], bs: boolean[]): string {
  return xs.join(" - ") + "/" + bs.join() + "/" + xs.join("");
}

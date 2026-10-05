// @redteam area=strings status=held
// @inputs [[[],"-"],[[0],"-"],[[-1,9007199254740992,-9007199254740992],", "],[[1,2,3],""],[[10,-0],"x"]]
export function joinNums(xs: number[], sep: string): string[] {
  return [xs.join(sep), xs.join()];
}

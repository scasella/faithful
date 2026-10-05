// @redteam area=strings status=held
// @inputs [[[]],[[true]],[[true,false,true]]]
export function joinBools(bs: boolean[]): string {
  return bs.join() + "|" + bs.join("");
}

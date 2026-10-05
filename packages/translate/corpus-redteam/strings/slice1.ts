// @redteam area=strings status=held
// @inputs [["abcdef",-2],["abcdef",-100],["abcdef",100],["",-1],["abc",0],["abc",-9007199254740992]]
export function slice1(s: string, a: number): string[] {
  return [s.slice(a), s.slice()];
}

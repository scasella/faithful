// @redteam area=strings status=held
// @inputs [[0,true,""],[-1,false,"x"],[9007199254740992,true,"é"],[-9007199254740992,false,"`${}`"],[100000000000000000000,true,""]]
export function templateFmt(n: number, b: boolean, s: string): string {
  return `${n}:${b}:${s}${""}${`[${n * 2 - n}]`}`;
}

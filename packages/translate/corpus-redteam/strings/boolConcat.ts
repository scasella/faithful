// @redteam area=strings status=held
// @inputs [[true,""],[false,"x"]]
export function boolConcat(b: boolean, s: string): string {
  return s + b + (!b) + `${b === true}`;
}

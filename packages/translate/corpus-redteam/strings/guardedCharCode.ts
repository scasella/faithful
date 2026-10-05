// @redteam area=strings status=held
// @inputs [["",0],["a",0],["a",1],["a",-1],["AB",1]]
export function guardedCharCode(s: string, i: number): boolean {
  return i < 0 || i >= s.length || s.charCodeAt(i) > 64;
}

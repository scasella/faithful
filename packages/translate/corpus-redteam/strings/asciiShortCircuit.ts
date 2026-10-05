// @redteam area=strings status=held
// @inputs [["É",0],["É",1],["a",1],["A",0],["",1]]
export function asciiShortCircuit(s: string, k: number): boolean[] {
  return [k > 0 && s.toLowerCase() === "a", k > 0 || s.toUpperCase() === "A", k > 0 ? s.toUpperCase() === "A" : false];
}

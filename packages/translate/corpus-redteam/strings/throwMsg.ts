// @redteam area=strings status=held
// @inputs [[0],[1],[2]]
export function throwMsg(k: number): string {
  if (k === 1) throw new Error("q\"b\\c\nd\te\u0001\u007fé\u2028{k}");
  if (k === 2) throw "plain é";
  return "ok";
}

// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[-9007199254740992],[9007199254740992],[-9007199254740991],[0]]
// @tags ["ok","ok","ok","ok"]
export function negLitMinMax(a: number): number {
  return Math.max(a, -9007199254740992) - Math.min(1, a) - 1;
}

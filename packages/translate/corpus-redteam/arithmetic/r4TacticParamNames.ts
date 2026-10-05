// @redteam area=arithmetic status=held expect=ok round=4
// parameters named like tactics that are NOT Lean tokens (omega, simp, exact, only, h): the model compiles under Core and Tactics
// @inputs [[1,2,3,4,5],[-7,3,-5,2,-9],[9007199254740992,1,0,0,0]]
// @tags ["ok","ok","ok"]
export function r4TacticParamNames(omega: number, simp: number, exact: number, only: number, h: number): number {
  return omega * simp - exact % (only + 1) + Math.floor(h / (only + 2));
}

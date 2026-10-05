// @redteam area=arithmetic status=held expect=ok round=4
// loop measure over variables named simp / decreasing_tactic
// @inputs [[0,10],[-5,5],[3,1]]
// @tags ["ok","ok","ok"]
export function r4LoopMeasureNamed(simp: number, decreasing_tactic: number): number {
  let c = 0;
  for (let i = simp; i < decreasing_tactic; i++) {
    c += i % 7;
  }
  return c;
}

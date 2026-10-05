// @redteam area=arithmetic status=held expect=ok round=4
// recursion measure over a parameter named omega (appears in termination_by / decreasing_by)
// @inputs [[5],[-2],[40]]
// @tags ["ok","ok","ok"]
export function r4RecMeasureNamedOmega(omega: number): number {
  if (omega <= 0) {
    return 0;
  }
  return (omega % 3) + r4RecMeasureNamedOmega(omega - 1);
}

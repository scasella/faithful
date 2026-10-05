// @redteam area=arithmetic status=held expect=refuse code=float round=2
export function floatModLit(a: number): number {
  return a % 2.5;
}

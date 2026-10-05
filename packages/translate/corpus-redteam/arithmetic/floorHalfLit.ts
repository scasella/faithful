// @redteam area=arithmetic status=held expect=refuse code=float round=2
export function floorHalfLit(a: number): number {
  return Math.floor(a / 0.5);
}

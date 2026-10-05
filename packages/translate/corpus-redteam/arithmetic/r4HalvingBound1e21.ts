// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=4
// a halving-loop bound literal outside +-2^53 (1e21)
export function r4HalvingBound1e21(a: number): number {
  let n = a;
  let c = 0;
  while (n > 1e21) {
    n = Math.floor(n / 2);
    c++;
  }
  return c;
}

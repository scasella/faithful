// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=4
// join on number[][] would ToString the inner arrays ("1,2;3"): must stay refused
export function r4JoinNested(xs: number[][]): string {
  return xs.join(";");
}

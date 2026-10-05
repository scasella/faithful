// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":3}
// Naive slice length (no relative indices) differs only for negative or out-of-order arguments.
export function original(xs: number[], a: number, b: number): number {
  return xs.slice(a, b).length;
}
export function candidate(xs: number[], a: number, b: number): number {
  return Math.max(0, Math.min(b, xs.length) - Math.max(0, Math.min(a, xs.length)));
}

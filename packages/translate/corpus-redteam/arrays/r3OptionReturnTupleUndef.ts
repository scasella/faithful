// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
export function firstLast(xs: number[]): [number, number] | undefined {
  if (xs.length === 0) return undefined;
  return [xs[0], xs[xs.length - 1]];
}

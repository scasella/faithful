// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2,1,3]],[[]]]
export function weird(xs: number[]): number[] {
  // the first parameter is called b: (b, a) => a - b is DESCENDING
  return xs.slice().sort((b, a) => a - b);
}

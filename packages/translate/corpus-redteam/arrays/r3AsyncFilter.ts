// @redteam area=arrays status=held
// @redteam note=async arrow filter callback: a Promise is truthy, so JS keeps every element
// @redteam expect=refuse code=async
// @redteam inputs=[[[5,0,-7]],[[]]]
export function asyncFilter(xs: number[]): number[] {
  return xs.filter(async (x: number): Promise<boolean> => x > 0);
}

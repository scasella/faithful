// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3,4,5]],[[]],[[1]]]
export function pairs(xs: number[]): number[][] {
  if (xs.length < 2) return [xs.slice()];
  return [xs.slice(0, 2)].concat(pairs(xs.slice(2)));
}

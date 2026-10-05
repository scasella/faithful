// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[5,6,7]],[[]],[[-3,0,3]]]
export function weigh(xs: number[]): number[] {
  return xs.map((x, i) => x * i - i);
}

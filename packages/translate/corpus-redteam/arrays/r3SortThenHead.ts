// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2]],[[]],[[-5]]]
export function maxOf(xs: number[]): number {
  return xs.slice().sort((a, b) => b - a)[0];
}

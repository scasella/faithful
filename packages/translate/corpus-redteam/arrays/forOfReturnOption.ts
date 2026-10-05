// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[-1,0,4,5]],[[]],[[-3]]]
export function firstPositive(xs: number[]): number | undefined {
  for (const x of xs) {
    if (x > 0) return x;
    if (x < -100) break;
  }
  return undefined;
}

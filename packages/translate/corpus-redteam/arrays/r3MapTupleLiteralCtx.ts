// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,-2]],[[]]]
export function tl(xs: number[]): Array<[number, string]> {
  return xs.map((x): [number, string] => [x * 2, `${x}`]);
}

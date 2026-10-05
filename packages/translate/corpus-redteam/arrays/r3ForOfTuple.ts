// @redteam area=arrays status=held
// @redteam note=completeness finding (sound): for...of over a homogeneous tuple is refused
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[3,4]],[[-1,1]]]
export function sumPair(t: [number, number]): number {
  let s = 0;
  for (const x of t) {
    s = s * 10 + x;
  }
  return s;
}

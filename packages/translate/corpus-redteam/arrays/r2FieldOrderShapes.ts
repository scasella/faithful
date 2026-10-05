// @redteam area=arrays status=held
// @redteam note=two structurally identical record types declared with different field order
// @redteam expect=ok
// @redteam inputs=[[[{"a":1,"b":"x"}]]]
type AB = { a: number; b: string };
type BA = { b: string; a: number };
export function swap(xs: AB[]): BA[] {
  const ys: BA[] = xs;
  return ys.concat([{ b: "z", a: 0 }]);
}

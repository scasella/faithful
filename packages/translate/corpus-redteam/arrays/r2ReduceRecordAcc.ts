// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,-1,7,2]],[[]],[[-5]]]
type B = { lo: number; hi: number };
export function bounds(xs: number[]): B {
  return xs.reduce((acc: B, x: number): B => ({ lo: Math.min(acc.lo, x), hi: Math.max(acc.hi, x) }), { lo: 0, hi: 0 });
}

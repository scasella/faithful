// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[5],0,1],[[1],3,1],[[1,2],1,0]]
// Round 4 (arrays): slice argument self-call (throws) before includes argument (out of range index).
export function r4IncludesOrderArgIndex(xs: number[], i: number, n: number): boolean {
  if (n <= 0) throw new Error("base");
  return xs.slice(0, r4IncludesOrderArgIndex(xs, i, n - 1) ? 1 : 2).includes(xs[i]);
}

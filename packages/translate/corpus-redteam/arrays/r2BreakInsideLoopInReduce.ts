// @redteam area=arrays status=held
// @redteam note=a counting loop with break and continue inside a reduce callback
// @redteam expect=ok
// @redteam inputs=[[[3,0,4,7],5],[[],1],[[10,-2],0]]
export function f(xs: number[], lim: number): number {
  return xs.reduce((acc, x) => {
    let s = acc;
    for (let i = 0; i < x; i++) {
      if (i % 2 === 1) continue;
      if (s > lim * 3) break;
      s = s + i;
    }
    return s;
  }, 0);
}

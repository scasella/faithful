// @redteam area=arrays status=held
// @redteam note=`return` from a for...of loop inside a map callback returns from the callback, not from the function
// @redteam expect=ok
// @redteam inputs=[[[1,5,9],[3,7,2]],[[],[1]],[[0],[]]]
export function firstAbove(xs: number[], ys: number[]): number[] {
  return xs.map((x) => {
    for (const y of ys) {
      if (y > x) return y;
    }
    return -1;
  });
}

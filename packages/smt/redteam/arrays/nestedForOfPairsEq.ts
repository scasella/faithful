// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// Pairs i < j summing to zero: index loops vs nested for...of over slices.
export function original(xs: number[]): number {
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      if (xs[i] + xs[j] === 0) {
        c = c + 1;
      }
    }
  }
  return c;
}
export function candidate(xs: number[]): number {
  let c = 0;
  let i = 0;
  for (const x of xs) {
    for (const y of xs.slice(i + 1)) {
      if (x + y === 0) {
        c = c + 1;
      }
    }
    i = i + 1;
  }
  return c;
}

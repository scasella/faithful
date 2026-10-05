// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 3: counting adjacent changes WITHOUT sorting overcounts [1, 0, 1].
export function original(xs: number[]): number {
  return xs.filter((x, i) => xs.indexOf(x) === i).length;
}
export function candidate(xs: number[]): number {
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    if (i === 0 || xs[i] !== xs[i - 1]) c = c + 1;
  }
  return c;
}

// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":2}
// Round 2, return from inside nested for...of over a nested array (flow through two loops) vs map/filter/indexOf.
export function original(xss: number[][], v: number): number {
  let r = 0;
  for (const xs of xss) {
    for (const x of xs) {
      if (x === v) {
        return r;
      }
    }
    r = r + 1;
  }
  return -1;
}
export function candidate(xss: number[][], v: number): number {
  return xss.map((xs) => xs.includes(v)).indexOf(true);
}

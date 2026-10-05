// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":1}
// Round 2, nested arrays: lengths of rows and the total, map + reduce vs nested loops.
export function original(xss: number[][]): number[] {
  const ls = xss.map((xs) => xs.length);
  return ls.concat([ls.reduce((a, l) => a + l, 0)]);
}
export function candidate(xss: number[][]): number[] {
  let out: number[] = [];
  let total = 0;
  for (const xs of xss) {
    let n = 0;
    for (const x of xs) {
      n = n + 1;
    }
    out = out.concat([n]);
    total = total + n;
  }
  return out.concat([total]);
}

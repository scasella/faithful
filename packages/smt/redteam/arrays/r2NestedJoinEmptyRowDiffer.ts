// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// Round 2, as r2NestedJoinEq but the loop skips the separator before an empty row.
export function original(xss: number[][]): string {
  return xss.map((xs) => xs.join("+")).join("|");
}
export function candidate(xss: number[][]): string {
  let s = "";
  for (let i = 0; i < xss.length; i++) {
    if (i > 0 && xss[i].length > 0) {
      s = s + "|";
    }
    s = s + xss[i].join("+");
  }
  return s;
}

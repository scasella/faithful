// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":2} adv=[[[[1,-2,3],[],[9007199254740992],[-9007199254740992,0]]]]
// Round 2, nested arrays: join each row then join the rows, vs nested loops building the same string.
export function original(xss: number[][]): string {
  return xss.map((xs) => xs.join("+")).join("|");
}
export function candidate(xss: number[][]): string {
  let s = "";
  for (let i = 0; i < xss.length; i++) {
    if (i > 0) {
      s = s + "|";
    }
    let row = "";
    for (let j = 0; j < xss[i].length; j++) {
      row = j === 0 ? `${xss[i][j]}` : `${row}+${xss[i][j]}`;
    }
    s = s + row;
  }
  return s;
}

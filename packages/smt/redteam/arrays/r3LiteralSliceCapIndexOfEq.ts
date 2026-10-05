// @smt-redteam expect=equal bounds={"array":1,"string":1,"int":3} adv=[[9007199254740992,-9007199254740992,[]]]
// Round 3: a slice of a list literal has a LITERAL length below its slot count ([i, j, i - j].slice(1, 2): length 1,
// 2 slots); concat, indexOf and equality must not read the extra slot.
export function original(i: number, j: number, xs: number[]): number {
  const t = [i, j, i - j].slice(1, 2).concat(xs);
  return t.indexOf(i - j) + 10 * t.length;
}
export function candidate(i: number, j: number, xs: number[]): number {
  const t = [j].concat(xs);
  return t.indexOf(i - j) + 10 * t.length;
}

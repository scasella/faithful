// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1}
// Round 2, boolean elements: includes / indexOf vs filter count.
export function original(bs: boolean[]): number {
  return bs.includes(true) ? bs.indexOf(true) : bs.filter((b) => !b).length * -1;
}
export function candidate(bs: boolean[]): number {
  let falses = 0;
  for (let i = 0; i < bs.length; i++) {
    if (bs[i]) {
      return i;
    }
    falses = falses + 1;
  }
  return -falses;
}

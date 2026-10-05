// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// Round 3: number of distinct values: filterI(indexOf(x) === i).length vs sorted adjacent-difference count.
export function original(xs: number[]): number {
  return xs.filter((x, i) => xs.indexOf(x) === i).length;
}
export function candidate(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  let c = 0;
  for (let i = 0; i < s.length; i++) {
    if (i === 0 || s[i] !== s[i - 1]) c = c + 1;
  }
  return c;
}

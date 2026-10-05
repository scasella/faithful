// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":3}
// Round 3: a filter predicate containing a loop (fuel inside slots, and padding slots must not leak).
export function original(xs: number[]): number[] {
  return xs.filter((x) => {
    let c = 0;
    for (let i = 0; i < x; i++) {
      c = c + 1;
    }
    return c % 2 === 1;
  });
}
export function candidate(xs: number[]): number[] {
  return xs.filter((x) => x > 0 && x % 2 === 1);
}

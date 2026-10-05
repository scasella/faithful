// @smt-redteam expect=differ mode=adaptive witness=[[50]]
// Round 3: a loop INSIDE a map callback whose trip count is the element value (fuel inside a slot). The candidate
// differs only for elements >= 50, which need more than U iterations; no claim may cover [[50]].
export function original(xs: number[]): number[] {
  return xs.map((x) => {
    let s = 0;
    for (let i = 0; i < x; i++) {
      s = s + 2;
    }
    return s;
  });
}
export function candidate(xs: number[]): number[] {
  return xs.map((x) => (x <= 0 ? 0 : x >= 50 ? 2 * x + 1 : 2 * x));
}

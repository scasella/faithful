// @smt-redteam expect=differ bounds={"array":4,"string":1,"int":2}
// Second largest element vs second largest distinct value (differs with duplicates of the maximum).
export function original(xs: number[]): number {
  const s = xs.slice().sort((a, b) => b - a);
  return s.length >= 2 ? s[1] : -100;
}
export function candidate(xs: number[]): number {
  const s = xs.slice().sort((a, b) => b - a);
  const rest = s.filter((x) => x !== s[0]);
  return s.length >= 2 ? (rest.length > 0 ? rest[0] : s[0]) : -100;
}

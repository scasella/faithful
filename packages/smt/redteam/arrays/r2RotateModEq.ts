// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Round 2, rotation by a non-negative amount below the length, two ways (slice/concat vs % indexing).
export function original(xs: number[], k: number): number[] {
  const n = xs.length;
  if (n === 0) {
    return xs;
  }
  const i = Math.abs(k) % n;
  return xs.slice(i).concat(xs.slice(0, i));
}
export function candidate(xs: number[], k: number): number[] {
  const n = xs.length;
  if (n === 0) {
    return xs;
  }
  const i = Math.abs(k) % n;
  return xs.map((x, j) => xs[(j + i) % n]);
}

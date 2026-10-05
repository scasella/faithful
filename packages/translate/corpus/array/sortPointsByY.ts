// @corpus class=array expect=ok
// @corpus note=key-difference comparator on an int field of a record; ties keep input order (stable sort), so the x order of equal-y points is observable

/**
 * Returns the points ordered by ascending `y`. Points with equal `y` keep
 * their original relative order. The input is not modified.
 */
export function sortPointsByY(
  points: { x: number; y: number }[],
): { x: number; y: number }[] {
  return points.slice().sort((a, b) => a.y - b.y);
}

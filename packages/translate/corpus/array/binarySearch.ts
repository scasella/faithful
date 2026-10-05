// @corpus class=array expect=ok
// @corpus note=termination measure is hi - lo (an expression, not a single variable); the final `&&` must short-circuit so sorted[lo] is never read when lo === length; unsorted input still terminates

/**
 * Index of `target` in an ascending array, or -1 if absent. When the value
 * occurs more than once, returns the index of the first occurrence.
 */
export function binarySearch(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sorted[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo < sorted.length && sorted[lo] === target ? lo : -1;
}

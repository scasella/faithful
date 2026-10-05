// @smt-redteam expect=differ mode=adaptive witness=[[1,3,5,7,9,11],[2,4,6,8,10,12]]
// Round 2, coverage classification. A two-pointer merge (loop bounded by a.length + b.length, leaving with `break`
// once one side is used up) runs at most a.length + 1 iterations when every element is 0 (a[i] <= b[j] always
// holds, so only i advances), but up to a.length + b.length = 12 when the values interleave: more than U = 10 at the
// top step. The coverage check pins every integer to 0 to decide "size-driven" vs "int-driven", so these
// LENGTH-driven exclusions are classified "int-driven", `unsat` stands, and verifiedToK never raises U for them.
// The candidate caps the merge at 10 steps and then copies the tails in the wrong order; it differs from the
// original exactly on inputs whose merge needs 11 or more steps (two arrays of 6, inside the default bounds).
export function original(a: number[], b: number[]): number[] {
  let out: number[] = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k < a.length + b.length; k++) {
    if (i >= a.length || j >= b.length) {
      break;
    }
    if (a[i] <= b[j]) {
      out = out.concat([a[i]]);
      i = i + 1;
    } else {
      out = out.concat([b[j]]);
      j = j + 1;
    }
  }
  return out.concat(a.slice(i), b.slice(j));
}
export function candidate(a: number[], b: number[]): number[] {
  let out: number[] = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k < Math.min(10, a.length + b.length); k++) {
    if (i >= a.length || j >= b.length) {
      break;
    }
    if (a[i] <= b[j]) {
      out = out.concat([a[i]]);
      i = i + 1;
    } else {
      out = out.concat([b[j]]);
      j = j + 1;
    }
  }
  return out.concat(b.slice(j), a.slice(i));
}

// @smt-redteam expect=equal bounds={"array":1,"string":3,"int":1} chars=["a",","]
// Round 2, split with a symbolic separator, then includes / indexOf on the parts vs a scan.
export function original(s: string, sep: string, t: string): number {
  return s.split(sep).includes(t) ? s.split(sep).indexOf(t) : -1;
}
export function candidate(s: string, sep: string, t: string): number {
  const parts = s.split(sep);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === t) {
      return i;
    }
  }
  return -1;
}

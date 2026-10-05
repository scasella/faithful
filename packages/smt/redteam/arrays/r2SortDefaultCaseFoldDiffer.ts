// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1} chars=["a","B","é"]
// Round 2, default sort() vs sorting by the lower-cased key ("B" before "a" by code unit, after it case-folded).
// toLowerCase carries the ascii check: "é" makes the candidate leave the model (a difference too).
interface W {
  s: string;
  low: string;
}
export function original(ss: string[]): string[] {
  return ss.slice().sort();
}
export function candidate(ss: string[]): string[] {
  return ss
    .map((s) => ({ s: s, low: s.toLowerCase() }))
    .sort((a, b) => (a.low < b.low ? -1 : a.low > b.low ? 1 : 0))
    .map((w: W) => w.s);
}

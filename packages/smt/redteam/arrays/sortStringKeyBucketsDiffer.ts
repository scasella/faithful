// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1} chars=["a","b","é"]
// Buckets for "", "a", "b" drop any other key; Z3 must find a key outside that alphabet (any BMP code unit).
export function original(xs: { s: string; v: number }[]): { s: string; v: number }[] {
  return xs.slice().sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
}
export function candidate(xs: { s: string; v: number }[]): { s: string; v: number }[] {
  return xs.filter((x) => x.s === "").concat(xs.filter((x) => x.s === "a"), xs.filter((x) => x.s === "b"));
}

// @redteam area=strings status=held
// @inputs [["",","],["a,b,,c",","],["abc","abc"],["aaaa","aa"]]
export function whileShrink(s: string, sep: string): number {
  let rest = s;
  let n = 0;
  while (rest.length > 0) {
    const i = rest.indexOf(sep);
    if (i < 0 || sep.length === 0) break;
    n = n + 1;
    rest = rest.slice(1);
  }
  return n;
}

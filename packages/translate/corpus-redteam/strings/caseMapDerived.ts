// @redteam area=strings status=held
// @inputs [["abc",0],["abc",5],["",3],["ÄBC",0],["ÄBC",1]]
export function caseMapDerived(s: string, k: number): string {
  if (k > 2) {
    return (s + "É").toLowerCase();
  }
  return s.slice(1).toUpperCase();
}

// @redteam area=arithmetic status=held expect=ok round=4
// number formatting of negatives adjacent to "-" in templates and concatenation
// @inputs [[-1,-2],[9007199254740992,-9007199254740992],[0,0],[-9007199254740992,1],[10,100],[-9007199254740992,-9007199254740992]]
// @tags ["ok","range-violation","ok","range-violation","ok","ok"]
export function r4TemplateNumNeg(a: number, b: number): string {
  return `${a}-${b}` + `${-a}${-b}` + (a - b) + "" + -(a - b) + `${a * -1}`;
}

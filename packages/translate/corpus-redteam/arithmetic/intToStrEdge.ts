// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[9007199254740992,-9007199254740992,1],[-9007199254740991,9007199254740991,-1],[1000000,1,1000000000],[-1000000,0,1000000000],[0,0,-5],[3,7,3002399751580331]]
// @tags ["ok","ok","ok","ok","ok","range-violation"]
export function intToStrEdge(a: number, b: number, c: number): string {
  return `${a}|${"" + b}|${[a, b].join()}|${a * c}|${-b}`;
}

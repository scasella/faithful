// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[7,3],[-7,3],[7,-3],[-7,-3],[0,3],[6,-3],[-6,3],[9007199254740992,-9007199254740991],[5,0]]
// @tags ["ok","ok","ok","ok","ok","ok","ok","ok","range-violation"]
export function modSignStr(a: number, b: number): string {
  return `${a % -b}/${-a % b}/${-(a % b)}/${a % b === -0}/${(a % b) % b}`;
}

// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[0],[-17],[-16],[30]]
// @tags ["ok","ok","ok","ok"]
export function decHexLoop(a: number): number {
  let n = a;
  let c = 0;
  while (n >= -0x10) {
    n -= 0x3;
    c += 1;
  }
  return c;
}

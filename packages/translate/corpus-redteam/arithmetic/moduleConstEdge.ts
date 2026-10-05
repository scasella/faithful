// @redteam area=arithmetic status=held expect=ok round=2
// module constants written as -2^53, hex 2^53 and 1_000_000
// @inputs [[0],[9007199254740992],[-9007199254740992],[1]]
// @tags ["ok","range-violation","range-violation","range-violation"]
const LO = -9007199254740992;
const HI = 0x20000000000000;
const SEP = 1_000_000;
export function moduleConstEdge(a: number): string {
  return `${a - LO}|${HI - a}|${LO}|${HI}|${a % SEP}`;
}

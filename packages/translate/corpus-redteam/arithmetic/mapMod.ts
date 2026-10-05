// @redteam area=arithmetic status=held expect=ok
// @inputs [[[1,-1,7,-7,9007199254740992,-9007199254740992],3],[[1,2],0],[[],0],[[-4,4],-2]]
export function mapMod(xs: number[], k: number): number[] { return xs.map((x) => x % k).filter((y) => y !== 0); }

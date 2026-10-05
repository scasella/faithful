// @redteam area=arithmetic status=held expect=ok
// @inputs [[[]],[[0,-1,9007199254740992,-9007199254740992]],[[0]]]
export function joinNeg(xs: number[]): string { return xs.join(",") + "|" + xs.map((x) => -x).join(); }

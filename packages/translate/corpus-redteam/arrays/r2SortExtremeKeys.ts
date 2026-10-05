// @redteam area=arrays status=held
// @redteam note=comparator a - b on keys at +-2^53: the difference is inexact in doubles but its sign is exact; comparators are not instrumented
// @redteam expect=ok
// @redteam inputs=[[[9007199254740992,-9007199254740992,9007199254740991,-9007199254740991,0,9007199254740992]]]
export function srt(xs: number[]): number[] {
  return xs.slice().sort((a, b) => a - b);
}

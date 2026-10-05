// @redteam area=arithmetic status=held expect=ok round=3
// length/indexOf arithmetic stays Int (no Nat truncation): .length is ascribed `: Int` before subtracting
// @inputs [[[1,2],"abc"],[[],""],[[1,2,3,4,5],"xa"],[[7],"aaaa"]]
// @tags ["ok","ok","ok","ok"]
export function r3LenDiff(xs: number[], s: string): number[] {
  return [xs.length - s.length, -xs.length, s.indexOf("a") - s.length, xs.length % -3, Math.floor(-s.length / 2)];
}

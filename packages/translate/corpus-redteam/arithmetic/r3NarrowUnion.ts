// @redteam area=arithmetic status=held expect=ok round=3
// b narrowed to the literal 5 after `b === 3` returns; the generator may also pass b outside {3, 5} (sound)
// @inputs [[3,7],[5,7],[3,3002399751580331],[5,-9007199254740992]]
// @tags ["ok","ok","range-violation","range-violation"]
export function r3NarrowUnion(b: 3 | 5, a: number): number {
  if (b === 3) { return a * b; }
  return a - b;
}

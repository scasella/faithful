// @redteam area=arithmetic status=held expect=ok round=4
// -0 from a * 0, Math.ceil of a small negative quotient, and % of a negative dividend is unobservable in subset v1 (ToString, ===, join, indexOf, includes, min/max all treat it as 0)
// @inputs [[-5,7],[-1,1],[0,0],[-9007199254740992,9007199254740991],[3,9]]
// @tags ["ok","ok","ok","ok","ok"]
export function r4NegZeroInvisible(a: number, b: number): string {
  const z = a * 0;
  const m = Math.ceil(-Math.abs(a) / (Math.abs(b) + 1));
  const r = -Math.abs(a) % (Math.abs(b) + 1);
  return `${z}|${m}|${r}|${[z, m, r].join()}|${z === 0}|${Math.min(z, 0)}|${Math.max(m, -0)}|${[z].indexOf(0)}|${[0].includes(r)}|${-0 < 0}|${"" + -z}`;
}

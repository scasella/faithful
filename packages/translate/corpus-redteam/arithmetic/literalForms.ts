// @redteam area=arithmetic status=held expect=ok round=2
// hex/binary/octal/separator literals as steps, bounds and divisors (TS normalizes NumericLiteral.text)
// @inputs [[5,100],[0,10],[-3,11],[7,9007199254740992]]
// @tags ["ok","ok","ok","ok"]
export function literalForms(n: number, m0: number): number {
  let c = 0;
  for (let i = 0x0; i < n; i += 0b10) {
    c += 1_0;
  }
  let m = m0;
  while (m > 1_0) {
    m = Math.floor(m / 0o2);
  }
  return c * 0x10 + m;
}

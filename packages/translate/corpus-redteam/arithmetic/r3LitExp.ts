// @redteam area=arithmetic status=held expect=ok round=3
// integer-valued literals written 10e-1, 1.5e1, .5e1, 0.0; the last input crosses 2^53
// @inputs [[3],[-9007199254740992],[9007199254740972],[9007199254740973]]
// @tags ["ok","ok","ok","range-violation"]
export function r3LitExp(a: number): number { return a * 10e-1 + 1.5e1 + .5e1 + 0.0; }

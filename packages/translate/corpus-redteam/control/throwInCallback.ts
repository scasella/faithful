// @redteam area=control status=held
// @redteam-expect refuse:unsupported-syntax
// @redteam-note refused: `throw` inside a callback is outside subset v1
export function f(xs: number[]): number[] { return xs.map((x) => { if (x < 0) throw new Error("neg"); return x; }); }

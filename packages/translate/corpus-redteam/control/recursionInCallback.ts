// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: a recursive call inside a callback is outside subset v1 (no termination measure)
export function f(xs: number[]): number { if (xs.length === 0) return 0; return [1].map((k) => f(xs.slice(k)))[0] + 1; }

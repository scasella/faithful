// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) in the incrementor o
// @redteam-note i = 0 would loop; i = 1 terminates but no measure: refused
export function f(n: number): number { let c = 0; for (let i = 1; i < n; i = i * 2) { c = c + 1; } return c; }

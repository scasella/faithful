// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) in the incrementor o
// @redteam-note i !== n never stops for n < 0: must be refused
export function f(n: number): number { let c = 0; for (let i = 0; i !== n; i++) { c = c + 1; } return c; }

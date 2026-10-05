// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) in the incrementor o
// @redteam-note terminating, refused because of the continue (documented conservative rule)
export function f(n: number): number { let i = 0; let s = 0; while (i < n) { i = i + 1; if (i % 2 === 0) continue; s = s + i; } return s; }

// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) in the incrementor o
export function f(xs: number[]): number { let c = 0; while (xs.length > 0) { xs = xs.slice(-1); c = c + 1; if (c > 100) return -1; } return c; }

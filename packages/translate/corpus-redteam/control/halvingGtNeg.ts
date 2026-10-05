// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) in the incrementor o
// @redteam-note n = 0 stays 0 forever: must be refused
export function f(n: number): number { let c = 0; while (n > -1) { n = Math.floor(n / 2); c = c + 1; if (c > 100) return -1; } return c; }

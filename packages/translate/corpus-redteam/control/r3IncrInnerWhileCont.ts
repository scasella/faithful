// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note round 3: inner while updates j by a top-level `j++` but its body also has its own `continue` (rule 2(b) forbids it), so it is refused although JS terminates (j++ runs before the continue); documented completeness refusal
export function f(n: number): number { let s = 0; for (let i = 0; i < n; ++i) { let j = 0; while (j < i) { j++; if (j === 2) continue; s += j; } } return s; }

// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note round 4: inner while with `continue` AFTER its top-level j++ is refused (the rule refuses any own continue, conservative; documented)
export function f(n: number, m: number): number { let i = 0; let s = 0; while (i < n) { let j = 0; while (j < m) { j++; if (j === 1) continue; s += j; } i += 1; } return s; }

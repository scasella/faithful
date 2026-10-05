// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[3],[0],[6]]
// @redteam-note round 4: inner break inside an else-if of a 3-way chain, outer continue on a flag, mixed int/string/bool state
export function f(n: number): string { let s = ""; let b = false; let t = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { if (j === i) { t += 1; } else if (j > i) { b = !b; break; } else { s = s + j; } } if (b) continue; s = s + "|"; } return s + t + b; }

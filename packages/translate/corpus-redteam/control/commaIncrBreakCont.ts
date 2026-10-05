// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[2],[5]]
export function f(n: number): number { let j = 0; let acc = 0; for (let i = 0; i < n; i++, j = j + 10) { if (i === 1) continue; if (i === 3) break; acc = acc + j; } return acc * 1000 + j; }

// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1234567,3],[1234567,0],[5,3],[0,0]]
// @redteam-note round 4: return from a branch only reached for a magic constant (explicit input)
export function f(a: number, b: number): number { let r = 0; for (let i = 0; i < b; i++) { if (a === 1234567) { if (i === 2) return -1; r += 2; } else { r += 1; } } return r; }

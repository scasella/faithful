// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1],[6],[27],[0],[-5]]
// @redteam-note round 4: bounded Collatz with break and mixed update
export function f(n: number): number { let x = n; let steps = 0; for (let i = 0; i < 200; i++) { if (x <= 1) break; if (x % 2 === 0) { x = Math.floor(x / 2); } else { x = 3 * x + 1; } steps++; } return steps; }

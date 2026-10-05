// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[6]]
// @redteam-note round 4: then-block declares a let shadowing the loop-carried `s` and assigns it; the outer s must not change
export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { if (i % 2 === 0) { let s = 100; s += i; } else { s += 1000; } s += 1; } return s; }
